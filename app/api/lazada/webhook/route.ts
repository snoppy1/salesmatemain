import { NextResponse, after } from "next/server";
import { verifySignature, fetchUserName } from "@/lib/lazadaChatClient";
import { ingestCustomerMessage, getConversationMode } from "@/lib/inboxRepo";
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
  content?: { text?: string } | string;
  text?: string;
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

// POST: รับ event ข้อความจาก Lazada IM (routing ด้วย seller/account id)
export async function POST(request: Request) {
  const raw = await request.text();
  const signature =
    request.headers.get("x-lazada-signature") ?? request.headers.get("authorization");

  if (!verifySignature(raw, signature, process.env.LAZADA_CHAT_SECRET ?? "")) {
    return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
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
    const text = textOf(m);
    if (!userId || !text.trim()) continue;

    const displayName = await fetchUserName(channel.access_token, userId);
    const conversationId = await ingestCustomerMessage(shopId, {
      channel: "lazada",
      lineUserId: userId,
      displayName,
      text,
      extId: m.message_id ?? m.msg_id,
    });
    if (!conversationId) continue;

    const mode = await getConversationMode(conversationId);
    if (mode === "auto") autoJobs.push({ conversationId });
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
