import { NextResponse, after } from "next/server";
import { createHmac, createHash } from "node:crypto";
import { verifySignature, fetchUserName } from "@/lib/lazadaChatClient";
import {
  ingestCustomerMessage,
  getConversationMode,
  setPendingHuman,
} from "@/lib/inboxRepo";
import { getChannelByAccountId } from "@/lib/lazadaChannelRepo";
import { processAutoReply } from "@/lib/autoReply";
import { query } from "@/lib/db";
import { newId } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * DIAGNOSTIC (ชั่วคราว): บันทึกทุก hit ที่ Lazada ยิงเข้ามา ลง webhook_log
 * เพื่อหาเหตุ "แชตไม่เข้า" — ดูว่ามาถึงไหม + ลายเซ็นตรง secret ตัวไหน — ลบออกเมื่อแก้เสร็จ
 */
async function logHit(
  method: string,
  headers: Headers,
  raw: string,
  signature: string | null,
): Promise<void> {
  try {
    const sig = (signature ?? "").replace(/^sha256=/, "");
    const sigLow = sig.toLowerCase();
    // ลองหลายสูตร × secret 3 ตัว หาว่า Lazada เซ็นแบบไหน
    const secrets: [string, string][] = [
      ["chat", process.env.LAZADA_CHAT_SECRET ?? ""],
      ["im", process.env.LAZADA_IM_APP_SECRET ?? ""],
      ["app", process.env.LAZADA_APP_SECRET ?? ""],
    ];
    let matched = "NONE";
    for (const [sn, s] of secrets) {
      if (!s) continue;
      const cands: [string, string][] = [
        ["hmac256-hex", createHmac("sha256", s).update(raw).digest("hex")],
        ["hmac256-b64", createHmac("sha256", s).update(raw).digest("base64")],
        ["sha256(s+b+s)", createHash("sha256").update(s + raw + s).digest("hex")],
        ["sha256(s+b)", createHash("sha256").update(s + raw).digest("hex")],
        ["sha256(b+s)", createHash("sha256").update(raw + s).digest("hex")],
        ["md5(s+b+s)", createHash("md5").update(s + raw + s).digest("hex")],
        ["hmac256-app+b", createHmac("sha256", s).update((process.env.LAZADA_IM_APP_KEY ?? "") + raw).digest("hex")],
      ];
      for (const [an, v] of cands) {
        if (sig && (v === sig || v.toLowerCase() === sigLow)) {
          matched = `${sn}:${an}`;
          break;
        }
      }
      if (matched !== "NONE") break;
    }
    await query(
      `INSERT INTO webhook_log (id, channel, method, at, headers, body, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId(),
        "lazada",
        method,
        Date.now(),
        JSON.stringify({
          sig: signature,
          "content-type": headers.get("content-type"),
          "user-agent": headers.get("user-agent"),
        }),
        raw.slice(0, 4000),
        JSON.stringify({
          sigGiven: sig.slice(0, 80),
          MATCHED: matched,
          haveChat: !!process.env.LAZADA_CHAT_SECRET,
          haveIm: !!process.env.LAZADA_IM_APP_SECRET,
          haveApp: !!process.env.LAZADA_APP_SECRET,
        }),
      ],
    );
  } catch {
    /* best-effort: ห้ามทำ webhook ล้ม */
  }
}

// บาง integration เรียก GET เพื่อ health-check / verify — ตอบ ok ไว้
export async function GET(request: Request) {
  await logHit("GET", request.headers, request.url, null);
  return NextResponse.json({ ok: true });
}

type LzMessage = {
  message_id?: string;
  msg_id?: string;
  type?: string;
  content?: { text?: string; url?: string } | string;
  text?: string;
  image_url?: string;
  url?: string;
  session_id?: string;
  buyer_id?: string;
  from_user_id?: string;
  user_id?: string;
};
type LzPayload = {
  seller_id?: string;
  shop_id?: string;
  data?: {
    seller_id?: string;
    shop_id?: string;
    messages?: LzMessage[];
  } & LzMessage;
};

function textOf(m: LzMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content?.text ?? m.text ?? "";
}
function userOf(m: LzMessage): string {
  return m.session_id ?? m.buyer_id ?? m.from_user_id ?? m.user_id ?? "";
}
function imageOf(m: LzMessage): string | undefined {
  const c = typeof m.content === "object" ? m.content : undefined;
  if (m.type === "image") return c?.url ?? m.image_url ?? m.url ?? undefined;
  if ((c?.url || m.image_url) && !textOf(m).trim()) return c?.url ?? m.image_url;
  return undefined;
}

// POST: รับ event ข้อความจาก Lazada IM (routing ด้วย seller/account id)
export async function POST(request: Request) {
  const raw = await request.text();
  const signature =
    request.headers.get("x-lazada-signature") ?? request.headers.get("authorization");

  await logHit("POST", request.headers, raw, signature); // DIAGNOSTIC (ชั่วคราว)

  // Lazada ยิงมา verify callback (และ retry) → ต้องตอบ 200 เสมอ ไม่งั้นขึ้น
  // "Unknown error, please check the availability of message receiving service"
  // ความปลอดภัย: ถ้าลายเซ็นไม่ผ่าน ตอบ 200 แต่ "ไม่ประมวลผล" ข้อความ (ไม่ ingest/ไม่ตอบ)
  const verified = verifySignature(raw, signature, process.env.LAZADA_CHAT_SECRET ?? "");
  if (!verified) {
    return NextResponse.json({ ok: true });
  }

  let payload: LzPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const accountId =
    payload.seller_id ?? payload.shop_id ?? payload.data?.seller_id ?? payload.data?.shop_id ?? "";
  if (!accountId) return NextResponse.json({ ok: true });
  const channel = await getChannelByAccountId(accountId);
  if (!channel) return NextResponse.json({ ok: true });
  const shopId = channel.shop_id;

  // รองรับทั้งข้อความเดี่ยวและแบบลิสต์
  const msgs: LzMessage[] = payload.data?.messages ?? (payload.data ? [payload.data] : []);

  const autoJobs: { conversationId: string }[] = [];
  for (const m of msgs) {
    const userId = userOf(m);
    if (!userId) continue;
    const imageUrl = imageOf(m);
    const text = imageUrl ? "" : textOf(m);
    if (!imageUrl && !text.trim()) continue;

    const displayName = await fetchUserName(channel.access_token, userId);
    const conversationId = await ingestCustomerMessage(shopId, {
      channel: "lazada",
      lineUserId: userId,
      displayName,
      text,
      extId: m.message_id ?? m.msg_id,
      kind: imageUrl ? "image" : "text",
      imageUrl,
    });
    if (!conversationId) continue;

    const mode = await getConversationMode(conversationId);
    if (mode === "auto") {
      if (imageUrl) {
        // ได้รูป → ยังไม่ตอบ รอลูกค้าพิมพ์คำถามก่อน แต่ขึ้น "รอตอบ" ให้แอดมินเห็น
        await setPendingHuman(conversationId, true);
      } else {
        autoJobs.push({ conversationId });
      }
    }
  }

  if (autoJobs.length) {
    after(async () => {
      for (const j of autoJobs) {
        await processAutoReply(shopId, j.conversationId, "");
      }
    });
  }

  return NextResponse.json({ ok: true });
}
