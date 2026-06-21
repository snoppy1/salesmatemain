import { NextResponse, after } from "next/server";
import { queryOne } from "@/lib/db";
import {
  verifySignature,
  fetchDisplayName,
  replyMessage,
} from "@/lib/lineClient";
import {
  ingestCustomerMessage,
  getConversationMode,
  getConversation,
  setPendingHuman,
  addAdminMessage,
} from "@/lib/inboxRepo";
import { getChannelByBotUserId } from "@/lib/lineChannelRepo";
import { getShopData } from "@/lib/shopRepo";
import { generateReply } from "@/lib/claude";
import { buildConversationContext } from "@/lib/prompt";

export const runtime = "nodejs";

/** fallback ร้านเดียวแบบเดิม (ผ่าน env) — ใช้เมื่อหา channel จาก destination ไม่เจอ */
async function resolveEnvShopId(): Promise<string | null> {
  const username = process.env.LINE_SHOP_USERNAME;
  if (username) {
    const row = await queryOne<{ shop_id: string }>(
      "SELECT shop_id FROM admins WHERE username = $1 LIMIT 1",
      [username.toLowerCase()],
    );
    if (row) return row.shop_id;
  }
  const first = await queryOne<{ id: string }>(
    "SELECT id FROM shops ORDER BY created_at ASC LIMIT 1",
  );
  return first?.id ?? null;
}

/** โหมด auto: AI ร่าง+ประเมิน → มั่นใจ ส่งเอง (Reply API) / ไม่มั่นใจ ตั้ง "รอตอบ" */
async function processAutoReply(
  shopId: string,
  conversationId: string,
  replyToken: string,
  accessToken: string,
): Promise<void> {
  try {
    const convo = await getConversation(shopId, conversationId);
    if (!convo) return;
    const shopData = await getShopData(shopId);
    const customerMsg = buildConversationContext(
      convo.customerName,
      convo.channel,
      convo.messages,
    );
    const result = await generateReply({
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      rules: shopData.rules,
      products: shopData.products,
      customerMsg,
    });
    if (result.needsHuman || !result.message.trim()) {
      await setPendingHuman(conversationId, true); // ให้คนตอบ
      return;
    }
    await replyMessage(accessToken, replyToken, result.message);
    await addAdminMessage(shopId, conversationId, result.message); // เคลียร์ pending ด้วย
  } catch {
    // ถ้า AI ล้ม ให้ตกไปเป็น "รอตอบ" จะได้ไม่หาย
    await setPendingHuman(conversationId, true).catch(() => {});
  }
}

type LineEvent = {
  type: string;
  replyToken?: string;
  message?: { id?: string; type: string; text?: string };
  source?: { userId?: string };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");

  let payload: { destination?: string; events?: LineEvent[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  let shopId: string | null = null;
  let channelSecret = "";
  let accessToken = "";

  const channel = payload.destination
    ? await getChannelByBotUserId(payload.destination)
    : null;
  if (channel) {
    shopId = channel.shop_id;
    channelSecret = channel.channel_secret;
    accessToken = channel.access_token;
  } else {
    shopId = await resolveEnvShopId();
    channelSecret = process.env.LINE_CHANNEL_SECRET ?? "";
    accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  }

  if (!shopId || !channelSecret) return NextResponse.json({ ok: true });

  if (!verifySignature(raw, signature, channelSecret)) {
    return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }

  const autoJobs: { conversationId: string; replyToken: string }[] = [];

  for (const ev of payload.events ?? []) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;
    const userId = ev.source?.userId ?? "";
    const text = ev.message.text ?? "";
    if (!userId || !text.trim()) continue;

    const displayName = await fetchDisplayName(accessToken, userId);
    const conversationId = await ingestCustomerMessage(shopId, {
      channel: "line",
      lineUserId: userId,
      displayName,
      text,
      extId: ev.message.id,
    });
    if (!conversationId) continue; // ซ้ำ (retry) — ข้าม

    const mode = await getConversationMode(conversationId);
    if (mode === "auto" && ev.replyToken) {
      autoJobs.push({ conversationId, replyToken: ev.replyToken });
    }
  }

  // ตอบ 200 เร็ว แล้วค่อยให้ AI ทำงานหลังตอบ (กัน LINE timeout/retry)
  if (autoJobs.length) {
    const sid = shopId;
    const token = accessToken;
    after(async () => {
      for (const j of autoJobs) {
        await processAutoReply(sid, j.conversationId, j.replyToken, token);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
