import { NextResponse, after } from "next/server";
import { queryOne } from "@/lib/db";
import {
  verifySignature,
  fetchDisplayName,
  getMessageContent,
} from "@/lib/lineClient";
import {
  ingestCustomerMessage,
  getConversationMode,
  setPendingHuman,
} from "@/lib/inboxRepo";
import { getChannelByBotUserId } from "@/lib/lineChannelRepo";
import { isBlobConfigured, putImage } from "@/lib/blobStore";
import { processAutoReply } from "@/lib/autoReply";

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
    if (ev.type !== "message" || !ev.message) continue;
    const userId = ev.source?.userId ?? "";
    if (!userId) continue;

    let kind: "text" | "image" = "text";
    let imageUrl: string | undefined;
    let blobKey: string | undefined;
    let text = "";

    if (ev.message.type === "text") {
      text = ev.message.text ?? "";
      if (!text.trim()) continue;
    } else if (ev.message.type === "image") {
      if (isBlobConfigured() && ev.message.id) {
        try {
          const { buffer, contentType } = await getMessageContent(
            accessToken,
            ev.message.id,
          );
          const up = await putImage(buffer, contentType);
          kind = "image";
          imageUrl = up.url;
          blobKey = up.key;
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          text = `🖼️ ลูกค้าส่งรูป [debug: capture-fail ${reason}]`;
        }
      } else {
        text = `🖼️ ลูกค้าส่งรูป [debug: blob=${isBlobConfigured()} id=${Boolean(ev.message.id)}]`;
      }
    } else {
      continue; // sticker/location/ฯลฯ — ข้ามไปก่อน (คงพฤติกรรมเดิม)
    }

    const displayName = await fetchDisplayName(accessToken, userId);
    const conversationId = await ingestCustomerMessage(shopId, {
      channel: "line",
      lineUserId: userId,
      displayName,
      text,
      extId: ev.message.id,
      kind,
      imageUrl,
      blobKey,
    });
    if (!conversationId) continue; // ซ้ำ (retry) — ข้าม

    const mode = await getConversationMode(conversationId);
    if (mode === "auto") {
      if (ev.message.type === "image") {
        // ได้รูป → ยังไม่ตอบ รอลูกค้าพิมพ์คำถามก่อน (ส่วนใหญ่ส่งรูปมาพร้อมคำถาม)
        // แต่ขึ้น "รอตอบ" ให้แอดมินเห็น เผื่อลูกค้าส่งแค่รูปแล้วเงียบไป
        await setPendingHuman(conversationId, true);
      } else if (ev.replyToken) {
        autoJobs.push({ conversationId, replyToken: ev.replyToken });
      }
    }
  }

  // ตอบ 200 เร็ว แล้วค่อยให้ AI ทำงานหลังตอบ (กัน LINE timeout/retry)
  if (autoJobs.length) {
    const sid = shopId;
    after(async () => {
      for (const j of autoJobs) {
        await processAutoReply(sid, j.conversationId, j.replyToken);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
