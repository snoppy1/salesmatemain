import { NextResponse, after } from "next/server";
import { verifySignature, fetchUserName } from "@/lib/facebookClient";
import {
  ingestCustomerMessage,
  getConversationMode,
  setPendingHuman,
} from "@/lib/inboxRepo";
import { getChannelByPageId } from "@/lib/facebookChannelRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

// GET: Meta ยืนยัน webhook ครั้งแรก → ตอบ hub.challenge ถ้า verify token ตรง
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.FB_VERIFY_TOKEN ?? "";
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

type FbMessaging = {
  sender?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
};
type FbEntry = { id?: string; messaging?: FbMessaging[] };

// POST: รับ event ข้อความจาก Messenger (webhook เดียวระดับแอป → routing ด้วย page id)
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(raw, signature, process.env.FB_APP_SECRET ?? "")) {
    return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }

  let payload: { object?: string; entry?: FbEntry[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (payload.object !== "page") return NextResponse.json({ ok: true });

  const autoJobs: { shopId: string; conversationId: string }[] = [];

  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue;
    const channel = await getChannelByPageId(entry.id);
    if (!channel) continue; // ไม่ใช่เพจของร้านไหนในระบบ
    const shopId = channel.shop_id;

    for (const ev of entry.messaging ?? []) {
      if (ev.message?.is_echo) continue; // ข้อความที่เพจส่งเอง — ข้าม
      const psid = ev.sender?.id ?? "";
      if (!psid) continue;
      const imageUrl = ev.message?.attachments?.find((a) => a.type === "image")
        ?.payload?.url;
      const text = (ev.message?.text ?? "").trim(); // เก็บคำถามที่มากับรูปด้วย (เดิมทิ้ง)
      if (!imageUrl && !text) continue;

      const displayName = await fetchUserName(channel.access_token, psid);
      const conversationId = await ingestCustomerMessage(shopId, {
        channel: "facebook",
        lineUserId: psid,
        displayName,
        text,
        extId: ev.message?.mid,
        kind: imageUrl ? "image" : "text",
        imageUrl,
      });
      if (!conversationId) continue; // ซ้ำ (retry) — ข้าม

      const mode = await getConversationMode(conversationId);
      if (mode === "auto") {
        if (imageUrl && !text) {
          // รูปล้วน (ยังไม่มีคำถาม) → รอลูกค้าพิมพ์คำถามก่อน ขึ้น "รอตอบ"
          await setPendingHuman(conversationId, true);
        } else {
          // มีข้อความ หรือ รูป+คำถาม → ให้ AI ตอบ (เห็นรูปในบริบทด้วย)
          autoJobs.push({ shopId, conversationId });
        }
      }
    }
  }

  // ตอบ 200 เร็ว แล้วค่อยให้ AI ทำงานหลังตอบ (กัน Meta timeout/retry)
  if (autoJobs.length) {
    after(async () => {
      for (const j of autoJobs) {
        await processAutoReply(j.shopId, j.conversationId, "");
      }
    });
  }

  return NextResponse.json({ ok: true });
}
