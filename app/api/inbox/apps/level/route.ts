import { NextResponse, after } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { setChannelLevel, isValidLevel } from "@/lib/inboxAppsRepo";
import { setChannelConversationsMode, listConversations } from "@/lib/inboxRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  let body: { channel?: string; level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const channel = body.channel ?? "";
  if (!channel) return NextResponse.json({ error: "ไม่ระบุแอป" }, { status: 400 });
  const level = body.level && isValidLevel(body.level) ? body.level : "off";
  const shopId = admin.shopId;

  await setChannelLevel(shopId, channel, level);
  await setChannelConversationsMode(shopId, channel, level === "off" ? "manual" : "auto");

  // เปิด AI: ตอบข้อความลูกค้าที่ค้างไว้ของแอปนี้ (ข้อความล่าสุดเป็นของลูกค้า)
  if (level !== "off") {
    const convos = await listConversations(shopId);
    const pending = convos.filter((c) => c.channel === channel && c.lastSender === "customer");
    if (pending.length) {
      after(async () => {
        for (const c of pending) await processAutoReply(shopId, c.id, "");
      });
    }
  }

  return NextResponse.json({ channel, level });
}
