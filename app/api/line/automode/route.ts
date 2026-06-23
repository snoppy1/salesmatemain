import { NextResponse, after } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getAutoLevel, setAutoLevel } from "@/lib/shopRepo";
import { setAllConversationsMode, listConversations } from "@/lib/inboxRepo";
import { processAutoReply } from "@/lib/autoReply";
import type { AutoLevel } from "@/lib/types";

export const runtime = "nodejs";

const LEVELS: AutoLevel[] = ["off", "safe", "night", "full"];

// ระดับการตอบ AI ระดับร้าน: off | safe | night | full (คุมทุกแชต ไม่มี override รายแชต)
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json({ level: await getAutoLevel(admin.shopId) });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const level = (LEVELS as string[]).includes(body.level ?? "")
    ? (body.level as AutoLevel)
    : "off";
  const shopId = admin.shopId;
  await setAutoLevel(shopId, level);
  // off = คนตอบเอง (manual), อื่นๆ = AI ทำงาน (auto)
  await setAllConversationsMode(shopId, level === "off" ? "manual" : "auto");

  // เปิด AI: ตอบข้อความที่ลูกค้าทักค้างไว้ให้เลย (ข้อความล่าสุดเป็นของลูกค้า)
  if (level !== "off") {
    const convos = await listConversations(shopId);
    const pending = convos.filter((c) => c.lastSender === "customer");
    if (pending.length) {
      after(async () => {
        for (const c of pending) {
          await processAutoReply(shopId, c.id, "");
        }
      });
    }
  }

  return NextResponse.json({ level });
}
