import "server-only";
import type { GenerateRequest } from "./types";
import {
  REPLY_SYSTEM_PROMPT,
  CHOICES_SYSTEM_PROMPT,
  ORDER_REPLY_SYSTEM_PROMPT,
  buildUserContent,
  buildUserContentParts,
  parseModelJson,
} from "./prompt";
import { getOrder, traceShipment, getOrdersByBuyer } from "./lazadaOrders";
import { runToolLoop, type ModelTurn } from "./toolLoop";
import { pickChatModel, CHAT_OPUS } from "./modelRouter";
import { embedQuery, embeddingsEnabled } from "./embeddings";
import { loadEmbeddingsByIds } from "./shopRepo";
import { RETRIEVAL_MIN_PRODUCTS } from "./catalogRetrieval";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * เตรียม hybrid retrieval: embed คำถามลูกค้า + โหลดเวกเตอร์สินค้า ใส่ลง req
 * best-effort — ถ้าไม่มีคีย์/พลาด/ติด rate limit จะไม่เซ็ต queryEmbedding → retrieval fallback ไป keyword ล้วน
 */
async function prepHybrid(req: GenerateRequest): Promise<void> {
  if (!embeddingsEnabled()) return;
  const products = req.products ?? [];
  if (products.length <= RETRIEVAL_MIN_PRODUCTS) return; // ร้านเล็กส่งคลังเต็มอยู่แล้ว ไม่ต้องดึง
  const qe = await embedQuery(req.customerMsg);
  if (!qe) return;
  req.queryEmbedding = qe;
  if (products.some((p) => !p.embedding)) {
    const map = await loadEmbeddingsByIds(products.map((p) => p.id));
    for (const p of products) {
      const v = map.get(p.id);
      if (v) p.embedding = v;
    }
  }
}

export class ClaudeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** ผลลัพธ์การร่างคำตอบแชต (auto/draft) */
export type ReplyResult = {
  message: string;
  needsHuman: boolean;
  reason: string;
  shouldUpsell: boolean;
  estAddedValue: number | null;
  upsellProduct: string;
};

/** แปลง JSON ดิบจากโมเดล → ReplyResult (pure, เทสต์ได้) */
export function parseReplyResult(obj: Record<string, unknown>): ReplyResult {
  const ev = obj.est_added_value;
  return {
    message: typeof obj.message === "string" ? obj.message : "",
    needsHuman: Boolean(obj.needs_human),
    reason: typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
    shouldUpsell: Boolean(obj.should_upsell),
    estAddedValue: typeof ev === "number" && Number.isFinite(ev) ? ev : null,
    upsellProduct: typeof obj.upsell_product === "string" ? obj.upsell_product : "",
  };
}

/** เรียก Claude แล้วคืน JSON object ที่ parse แล้ว (โยน ClaudeError ถ้าพลาด) */
async function callClaudeRaw(
  systemPrompt: string,
  req: GenerateRequest,
  model: string,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ฝั่งเซิร์ฟเวอร์", 500);
  }

  const { stable, customer } = buildUserContentParts(req);
  const imgs = req.imageUrls ?? [];
  // Prompt caching: ระบบ prompt + (ร้าน+คลังสินค้า) ซ้ำทุกข้อความของร้านเดิม → ใส่ cache_control
  // อ่านซ้ำใน 5 นาทีจ่ายแค่ ~10% (คำตอบเหมือนเดิม แคชแค่ลดต้นทุน token ส่วนที่ซ้ำ); รูปต่อท้าย customer
  const content = [
    { type: "text", text: stable, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: customer },
    ...imgs.map((url) => ({ type: "image", source: { type: "url", url } })),
  ];

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        system: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } },
        ],
        messages: [{ role: "user", content }],
      }),
    });
  } catch {
    throw new ClaudeError("เชื่อมต่อ Anthropic API ไม่สำเร็จ", 502);
  }

  if (!res.ok) {
    throw new ClaudeError(`Anthropic API ตอบกลับผิดพลาด (${res.status})`, 502);
  }

  const data = (await res.json().catch(() => null)) as {
    content?: Array<{ type: string; text?: string }>;
  } | null;
  const rawText = data?.content?.find((c) => c.type === "text")?.text ?? "";

  try {
    return parseModelJson(rawText) as Record<string, unknown>;
  } catch {
    throw new ClaudeError("อ่านคำตอบของ AI ไม่สำเร็จ", 502);
  }
}

/** กล่องแชต: ตอบลูกค้าเสมอ + ประเมิน needs_human (ใช้ทั้ง draft และ auto) */
export async function generateReply(req: GenerateRequest): Promise<ReplyResult> {
  await prepHybrid(req); // embed คำถาม + โหลด vector สินค้า (best-effort)
  const { model } = pickChatModel(req); // router: Sonnet ทั่วไป / Opus เคสเสี่ยง
  const obj = await callClaudeRaw(REPLY_SYSTEM_PROMPT, req, model);
  return parseReplyResult(obj);
}

/** โหมด manual: เสนอ 2-3 คำตอบให้แอดมินเลือก */
export async function generateChoices(req: GenerateRequest): Promise<string[]> {
  await prepHybrid(req);
  const { model } = pickChatModel(req);
  const obj = await callClaudeRaw(CHOICES_SYSTEM_PROMPT, req, model);
  const arr = Array.isArray(obj.choices) ? obj.choices : [];
  return arr
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
}

/* ---------- ออเดอร์/จัดส่ง: ตอบด้วย tool-calling ---------- */

export type OrderToolCtx = { token: string; buyerId: string | null; channel: string };

/** นิยาม tool ให้ Claude — ใส่ lookup_orders_by_buyer เฉพาะตอนรู้ buyer (แชต Lazada) */
export function buildOrderTools(buyerId: string | null): unknown[] {
  const tools: unknown[] = [
    {
      name: "lookup_order",
      description: "ดูสถานะออเดอร์จากเลขออเดอร์",
      input_schema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    },
    {
      name: "track_shipment",
      description: "เช็คว่าพัสดุของออเดอร์นี้ส่งถึงไหนแล้ว จากเลขออเดอร์",
      input_schema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    },
  ];
  if (buyerId) {
    tools.push({
      name: "lookup_orders_by_buyer",
      description: "ดูรายการออเดอร์ล่าสุดของลูกค้ารายนี้ (รู้ตัวตนจากแชต)",
      input_schema: { type: "object", properties: {}, required: [] },
    });
  }
  return tools;
}

/** รัน tool จริง (ค้นข้อมูล Lazada) แล้วคืนผลเป็นข้อความให้โมเดลอ่าน */
export async function dispatchOrderTool(
  name: string,
  input: Record<string, unknown>,
  ctx: OrderToolCtx,
): Promise<string> {
  const orderId = String(input.orderId ?? "").trim();
  if (name === "lookup_order") {
    const o = await getOrder(ctx.token, orderId);
    if (!o) return "ไม่พบออเดอร์นี้";
    return `ออเดอร์ ${o.orderId}: สถานะ ${o.statusText} | สินค้า: ${o.items.map((i) => `${i.name} x${i.quantity}`).join(", ")}`;
  }
  if (name === "track_shipment") {
    const t = await traceShipment(ctx.token, orderId);
    if (!t) return "ไม่พบข้อมูลการจัดส่งของออเดอร์นี้";
    return `ออเดอร์ ${t.orderId}: ${t.statusText} | ขนส่ง ${t.carrier} | เลขพัสดุ ${t.trackingNumber}`;
  }
  if (name === "lookup_orders_by_buyer") {
    if (!ctx.buyerId) return "ไม่ทราบตัวตนลูกค้า";
    const orders = await getOrdersByBuyer(ctx.token, ctx.buyerId);
    if (!orders.length) return "ไม่พบออเดอร์ของลูกค้ารายนี้";
    return orders.map((o) => `ออเดอร์ ${o.orderId}: ${o.statusText}`).join("\n");
  }
  return "ไม่รู้จักเครื่องมือนี้";
}

/** ตอบเรื่องออเดอร์/จัดส่งโดยใช้ tool ค้นข้อมูลจริงก่อน (Anthropic tool-use loop) */
export async function generateReplyWithTools(
  req: GenerateRequest,
  ctx: OrderToolCtx,
): Promise<ReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ฝั่งเซิร์ฟเวอร์", 500);
  }
  await prepHybrid(req);
  const tools = buildOrderTools(ctx.buyerId);

  const callModel = async (
    messages: { role: "user" | "assistant"; content: unknown }[],
  ): Promise<ModelTurn> => {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CHAT_OPUS, // ออเดอร์/จัดส่ง = เดิมพันสูง (เงิน/ที่อยู่/tool) → คง Opus
          max_tokens: 900,
          system: ORDER_REPLY_SYSTEM_PROMPT,
          tools,
          messages,
        }),
      });
    } catch {
      throw new ClaudeError("เชื่อมต่อ Anthropic API ไม่สำเร็จ", 502);
    }
    if (!res.ok) {
      throw new ClaudeError(`Anthropic API ตอบกลับผิดพลาด (${res.status})`, 502);
    }
    const data = (await res.json().catch(() => null)) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    } | null;
    const content = data?.content ?? [];
    const toolCalls = content
      .filter((c) => c.type === "tool_use")
      .map((c) => ({ id: c.id ?? "", name: c.name ?? "", input: (c.input ?? {}) as Record<string, unknown> }));
    const text = content.find((c) => c.type === "text")?.text ?? "";
    return { toolUse: data?.stop_reason === "tool_use", assistantContent: content, toolCalls, text };
  };

  const finalText = await runToolLoop({
    initialContent: buildUserContent(req),
    callModel,
    runTool: (name, input) => dispatchOrderTool(name, input, ctx),
  });

  let obj: Record<string, unknown> = {};
  try {
    obj = parseModelJson(finalText) as Record<string, unknown>;
  } catch {
    // โมเดลตอบเป็นข้อความล้วน (เช่น ถามเลขออเดอร์) → ไม่ถือเป็นการพ่วง
    return { message: finalText.trim(), needsHuman: false, reason: "", shouldUpsell: false, estAddedValue: null, upsellProduct: "" };
  }
  const parsed = parseReplyResult(obj);
  // order path: ถ้า JSON ไม่มี message ให้ fallback เป็นข้อความสุดท้าย
  return { ...parsed, message: parsed.message || finalText.trim() };
}
