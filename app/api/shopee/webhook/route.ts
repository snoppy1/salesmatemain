import { NextResponse, after } from "next/server";
import { verifySignature, fetchUserName } from "@/lib/shopeeChatClient";
import {
  ingestCustomerMessage,
  getConversationMode,
  setPendingHuman,
} from "@/lib/inboxRepo";
import { getChannelByAccountId } from "@/lib/shopeeChannelRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

// บาง integration เรียก GET เพื่อ health-check — ตอบ ok ไว้
export async function GET() {
  return NextResponse.json({ ok: true });
}

type ShContent = {
  conversation_id?: string | number;
  message_id?: string | number;
  from_id?: string | number;
  from_user_name?: string;
  message_type?: string;
  content?: { text?: string; url?: string } | string;
  text?: string;
  image_url?: string;
  url?: string;
};
type ShPayload = {
  shop_id?: string | number;
  code?: number;
  data?: {
    type?: string;
    content?: ShContent;
    messages?: ShContent[];
  };
};

function textOf(m: ShContent): string {
  if (typeof m.content === "string") return m.content;
  return m.content?.text ?? m.text ?? "";
}
function userOf(m: ShContent): string {
  return m.from_id != null ? String(m.from_id) : "";
}
function imageOf(m: ShContent): string | undefined {
  if (m.message_type !== "image") return undefined;
  const c = typeof m.content === "object" ? m.content : undefined;
  return c?.url ?? m.image_url ?? m.url ?? undefined;
}

function webhookUrlOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/shopee/webhook`;
}

// POST: รับ event ข้อความจาก Shopee push (routing ด้วย shop_id)
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("authorization");
  const url = webhookUrlOf(request);

  if (!verifySignature(url, raw, signature)) {
    return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }

  let payload: ShPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const accountId = payload.shop_id != null ? String(payload.shop_id) : "";
  if (!accountId) return NextResponse.json({ ok: true });
  const channel = await getChannelByAccountId(accountId);
  if (!channel) return NextResponse.json({ ok: true });
  const shopId = channel.shop_id;

  // รองรับทั้งข้อความเดี่ยวและแบบลิสต์
  const msgs: ShContent[] =
    payload.data?.messages ?? (payload.data?.content ? [payload.data.content] : []);

  const autoJobs: { conversationId: string }[] = [];
  for (const m of msgs) {
    const userId = userOf(m);
    if (!userId) continue;
    const imageUrl = imageOf(m);
    // ชนิดที่ไม่ใช่ text/image (เช่น sticker/order) → ข้าม
    if (!imageUrl && m.message_type && m.message_type !== "text") continue;
    const text = imageUrl ? "" : textOf(m);
    if (!imageUrl && !text.trim()) continue;

    const displayName =
      m.from_user_name || (await fetchUserName(channel.access_token, userId));
    const conversationId = await ingestCustomerMessage(shopId, {
      channel: "shopee",
      lineUserId: userId,
      displayName,
      text,
      extId: m.message_id != null ? String(m.message_id) : undefined,
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
