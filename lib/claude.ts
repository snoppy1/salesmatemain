import "server-only";
import type { GenerateRequest } from "./types";
import {
  REPLY_SYSTEM_PROMPT,
  CHOICES_SYSTEM_PROMPT,
  ORDER_REPLY_SYSTEM_PROMPT,
  buildUserContent,
  parseModelJson,
} from "./prompt";
import { getOrder, traceShipment, getOrdersByBuyer } from "./lazadaOrders";
import { runToolLoop, type ModelTurn } from "./toolLoop";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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
};

/** เรียก Claude แล้วคืน JSON object ที่ parse แล้ว (โยน ClaudeError ถ้าพลาด) */
async function callClaudeRaw(
  systemPrompt: string,
  req: GenerateRequest,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ฝั่งเซิร์ฟเวอร์", 500);
  }

  const userContent = buildUserContent(req);
  const imgs = req.imageUrls ?? [];
  // มีรูป → ส่งเป็น content blocks (text + image url) ให้ Claude ดูภาพ; ไม่มีรูป → string เดิม (ไม่มีต้นทุนรูปเพิ่ม)
  const content =
    imgs.length === 0
      ? userContent
      : [
          { type: "text", text: userContent },
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
        model: MODEL,
        max_tokens: 900,
        system: systemPrompt,
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
  const obj = await callClaudeRaw(REPLY_SYSTEM_PROMPT, req);
  return {
    message: typeof obj.message === "string" ? obj.message : "",
    needsHuman: Boolean(obj.needs_human),
    reason: typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
  };
}

/** โหมด manual: เสนอ 2-3 คำตอบให้แอดมินเลือก */
export async function generateChoices(req: GenerateRequest): Promise<string[]> {
  const obj = await callClaudeRaw(CHOICES_SYSTEM_PROMPT, req);
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
          model: MODEL,
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
    // โมเดลตอบเป็นข้อความล้วน (เช่น ถามเลขออเดอร์) → ใช้เป็น message ตรงๆ
    return { message: finalText.trim(), needsHuman: false, reason: "" };
  }
  return {
    message: typeof obj.message === "string" ? obj.message : finalText.trim(),
    needsHuman: Boolean(obj.needs_human),
    reason: typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
  };
}
