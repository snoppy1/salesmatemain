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

/**
 * รูปแบบจริงของ Lazada IM push (ยืนยันจาก event จริง):
 * { seller_id, message_type, data:{...} }
 *  - message_type 2  = ข้อความใหม่ (data มี content/from_user_id/message_id)
 *  - message_type 19 = SESSION_UPDATE (แค่ unread_count — ไม่มีตัวข้อความ → ข้าม)
 * data.content = JSON string เช่น {"txt":"..."} (text) ; from_account_type 1 = ลูกค้า, 2 = ร้าน
 */
type LzData = {
  from_account_type?: number;
  to_account_type?: number;
  from_user_id?: string;
  message_id?: string;
  type?: number;
  content?: string;
  auto_reply?: boolean;
  session_id?: string;
};
type LzPayload = {
  seller_id?: string;
  shop_id?: string;
  message_type?: number;
  data?: LzData & { seller_id?: string; shop_id?: string };
};

/** แกะ content ของ Lazada IM (เป็น JSON string {"txt":"..."}) → {text, imageUrl} */
function parseImContent(content: unknown): { text: string; imageUrl?: string } {
  if (content == null) return { text: "" };
  let c: unknown = content;
  if (typeof content === "string") {
    try {
      c = JSON.parse(content);
    } catch {
      return { text: content }; // ไม่ใช่ JSON → ใช้ตามนั้น
    }
  }
  if (typeof c === "string") return { text: c };
  const o = (c ?? {}) as Record<string, unknown>;
  const txt = o.txt ?? o.text ?? "";
  const img = o.imgUrl ?? o.image_url ?? o.imageUrl ?? o.url ?? o.image;
  return {
    text: typeof txt === "string" ? txt : "",
    imageUrl: typeof img === "string" && img ? img : undefined,
  };
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
  const verified = verifySignature(
    raw,
    signature,
    process.env.LAZADA_CHAT_SECRET ?? "",
    process.env.LAZADA_IM_APP_KEY ?? "",
  );
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

  // สนใจเฉพาะ event "ข้อความใหม่" (message_type 2) — 19 = session update ฯลฯ ข้าม
  const d = payload.data;
  if (payload.message_type !== 2 || !d) return NextResponse.json({ ok: true });
  // เฉพาะข้อความ "จากลูกค้า" (from_account_type 1 = buyer) + ไม่ใช่ auto-reply — กัน echo ฝั่งร้าน/ตัวเอง
  if (d.from_account_type !== 1 || d.auto_reply) return NextResponse.json({ ok: true });

  const userId = String(d.from_user_id ?? "");
  const sessionId = String(d.session_id ?? "");
  if (!userId) return NextResponse.json({ ok: true });

  const { text, imageUrl } = parseImContent(d.content);
  if (!text.trim() && !imageUrl) return NextResponse.json({ ok: true });

  // ชื่อ = title ของ session (อาจถูก mask); เก็บ session_id ไว้ใช้ส่งข้อความกลับ
  const displayName = await fetchUserName(channel.access_token, sessionId);
  const conversationId = await ingestCustomerMessage(shopId, {
    channel: "lazada",
    lineUserId: userId,
    displayName,
    text,
    extId: d.message_id ? String(d.message_id) : undefined,
    kind: imageUrl ? "image" : "text",
    imageUrl,
    sessionId,
  });
  if (conversationId) {
    const mode = await getConversationMode(conversationId);
    if (mode === "auto") {
      if (imageUrl) await setPendingHuman(conversationId, true);
      else
        after(async () => {
          await processAutoReply(shopId, conversationId, "");
        });
    }
  }

  return NextResponse.json({ ok: true });
}
