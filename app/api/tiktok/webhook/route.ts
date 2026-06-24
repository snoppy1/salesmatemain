import { NextResponse, after } from "next/server";
import { verifySignature, fetchUserName } from "@/lib/tiktokClient";
import { ingestCustomerMessage, getConversationMode } from "@/lib/inboxRepo";
import { getChannelByAccountId } from "@/lib/tiktokChannelRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

// บาง integration เรียก GET เพื่อ health-check — ตอบ ok ไว้
export async function GET() {
  return NextResponse.json({ ok: true });
}

type TtMessage = {
  message_id?: string;
  msg_id?: string;
  type?: string;
  content?: { text?: string; url?: string } | string;
  text?: string;
  image_url?: string;
  url?: string;
  sender?: { id?: string };
  from_user_id?: string;
  user_id?: string;
};
type TtPayload = {
  shop_id?: string;
  data?: {
    shop_id?: string;
    messages?: TtMessage[];
  } & TtMessage;
};

function textOf(m: TtMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content?.text ?? m.text ?? "";
}
function userOf(m: TtMessage): string {
  return m.sender?.id ?? m.from_user_id ?? m.user_id ?? "";
}
function imageOf(m: TtMessage): string | undefined {
  const c = typeof m.content === "object" ? m.content : undefined;
  if (m.type === "image") return c?.url ?? m.image_url ?? m.url ?? undefined;
  // บางรูปแบบส่ง url รูปมาโดยไม่มี type → ถือเป็นรูปถ้าไม่มีข้อความ
  if ((c?.url || m.image_url) && !textOf(m).trim()) return c?.url ?? m.image_url;
  return undefined;
}

// POST: รับ event ข้อความจาก TikTok IM (routing ด้วย shop/account id)
export async function POST(request: Request) {
  const raw = await request.text();
  const signature =
    request.headers.get("x-tts-signature") ?? request.headers.get("authorization");

  if (!verifySignature(raw, signature, process.env.TIKTOK_CHAT_SECRET ?? "")) {
    return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }

  let payload: TtPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const accountId = payload.shop_id ?? payload.data?.shop_id ?? "";
  if (!accountId) return NextResponse.json({ ok: true });
  const channel = await getChannelByAccountId(accountId);
  if (!channel) return NextResponse.json({ ok: true });
  const shopId = channel.shop_id;

  // รองรับทั้งข้อความเดี่ยวและแบบลิสต์
  const msgs: TtMessage[] = payload.data?.messages ?? (payload.data ? [payload.data] : []);

  const autoJobs: { conversationId: string }[] = [];
  for (const m of msgs) {
    const userId = userOf(m);
    if (!userId) continue;
    const imageUrl = imageOf(m);
    const text = imageUrl ? "" : textOf(m);
    if (!imageUrl && !text.trim()) continue;

    const displayName = await fetchUserName(channel.access_token, userId);
    const conversationId = await ingestCustomerMessage(shopId, {
      channel: "tiktok",
      lineUserId: userId,
      displayName,
      text,
      extId: m.message_id ?? m.msg_id,
      kind: imageUrl ? "image" : "text",
      imageUrl,
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
