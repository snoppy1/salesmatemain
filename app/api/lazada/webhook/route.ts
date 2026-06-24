import { NextResponse, after } from "next/server";
import { verifySignature, fetchUserName } from "@/lib/lazadaChatClient";
import {
  ingestCustomerMessage,
  getConversationMode,
  setPendingHuman,
} from "@/lib/inboxRepo";
import { getChannelByAccountId } from "@/lib/lazadaChannelRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

// บาง integration เรียก GET เพื่อ health-check — ตอบ ok ไว้
export async function GET() {
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
