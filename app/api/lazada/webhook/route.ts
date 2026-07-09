import { NextResponse, after } from "next/server";
import { verifySignature, fetchUserName, fetchHistory } from "@/lib/lazadaChatClient";
import {
  ingestCustomerMessage,
  ingestExternalAdminMessage,
  getConversationMode,
  setPendingHuman,
  claimHistorySync,
  backfillMessages,
} from "@/lib/inboxRepo";
import { getChannelByAccountId } from "@/lib/lazadaChannelRepo";
import { refreshLazadaIfDue } from "@/lib/lazadaTokens";
import { scheduleAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";
export const maxDuration = 40; // เผื่อ debounce 10 วิ + เวลา AI ตอบ (รันใน after() หลังตอบ 200)

// บาง integration เรียก GET เพื่อ health-check / verify — ตอบ ok ไว้
export async function GET() {
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
  send_time?: number;
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
    // รูปบางแบบส่งมาเป็น HTML <img src="..."> → แกะ src เป็นรูป (ไม่ใช่โชว์ tag ดิบ)
    const img = content.match(/<img[^>]*\bsrc=["']([^"']+)["']/i);
    if (img) return { text: "", imageUrl: img[1] };
    try {
      c = JSON.parse(content);
    } catch {
      return { text: content }; // ไม่ใช่ JSON → ใช้ตามนั้น
    }
  }
  if (typeof c === "string") return { text: c };
  const o = (c ?? {}) as Record<string, unknown>;
  // การ์ดสินค้า (ลูกค้าแชร์สินค้า) — ไม่มี txt มีแต่ itemId/title/price → ให้ AI อ่านรู้ว่าหมายถึงสินค้านี้
  if (o.itemId) {
    const title = typeof o.title === "string" && o.title ? o.title : `สินค้า ${o.itemId}`;
    const price = typeof o.price === "string" && o.price ? ` ราคา ${o.price}` : "";
    // เป็น text (ไม่ใช่ image) → AI อ่าน title แล้วตอบได้เลย ไม่เข้า path "รอคนตอบ"
    return { text: `[ลูกค้าส่งการ์ดสินค้า] ${title}${price}` };
  }
  let txt = o.txt ?? o.text ?? "";
  // txt เป็น JSON ซ้อน ({"th":...}) เช่น auto-greeting → แกะอีกชั้น
  if (typeof txt === "string" && txt.trim().startsWith("{")) {
    try {
      const inner = JSON.parse(txt) as Record<string, unknown>;
      txt = (inner.th ?? inner.txt ?? inner.en ?? txt) as string;
    } catch {
      /* คง txt เดิม */
    }
  }
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

  // ต่ออายุ token จาก traffic จริง (refresh token IM อายุแค่ ~24 ชม. — ต่อจากทุก push กัน token ตายเวลา cron ขาด)
  after(() => refreshLazadaIfDue(channel));

  // สนใจเฉพาะ event "ข้อความใหม่" (message_type 2) — 19 = session update ฯลฯ ข้าม
  const d = payload.data;
  if (payload.message_type !== 2 || !d) return NextResponse.json({ ok: true });

  const userId = String(d.from_user_id ?? "");
  const sessionId = String(d.session_id ?? "");
  const { text, imageUrl } = parseImContent(d.content);
  if (!text.trim() && !imageUrl) return NextResponse.json({ ok: true });

  // ข้อความฝั่งร้าน (ตอบจากแอป Lazada / auto-greeting ของร้าน) → บันทึกเป็นแอดมินให้เห็นในเว็บ
  // echo ของที่เราส่งเองไม่ซ้ำ เพราะตอนส่งเราเก็บ message_id เป็น ext_id ไว้แล้ว (dedup)
  if (d.from_account_type !== 1) {
    if (sessionId) {
      await ingestExternalAdminMessage("lazada", sessionId, {
        text: text.trim() ? text : "[รูปภาพ]",
        extId: d.message_id ? String(d.message_id) : undefined,
        createdAt: Number(d.send_time) || undefined,
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (!userId) return NextResponse.json({ ok: true });

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
    createdAt: Number(d.send_time) || undefined, // เวลาส่งจริง → เรียงตรงกับประวัติ
  });
  if (conversationId) {
    const mode = await getConversationMode(conversationId);
    if (mode === "auto" && imageUrl) await setPendingHuman(conversationId, true);
    const cid = conversationId;
    const token = channel.access_token;
    after(async () => {
      // ดึงประวัติแชตเก่าเข้า inbox ครั้งแรกของบทสนทนานี้ (ครั้งเดียว)
      if (sessionId && (await claimHistorySync(cid))) {
        const hist = await fetchHistory(token, sessionId);
        if (hist.length) await backfillMessages(cid, hist);
      }
      if (mode === "auto" && !imageUrl) await scheduleAutoReply(shopId, cid, "");
    });
  }

  return NextResponse.json({ ok: true });
}
