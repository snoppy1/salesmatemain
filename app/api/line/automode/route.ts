import { NextResponse, after } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getAutoReply, setAutoReply } from "@/lib/shopRepo";
import { setAllConversationsMode, listConversations } from "@/lib/inboxRepo";
import { getChannelByShop } from "@/lib/lineChannelRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

// สวิตช์รวมระดับร้าน: ให้ AI ตอบเองอัตโนมัติ (คุมทุกแชต ไม่มี override รายแชต)
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json({ autoReply: await getAutoReply(admin.shopId) });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { autoReply?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const value = Boolean(body.autoReply);
  const shopId = admin.shopId;
  await setAutoReply(shopId, value);
  // สวิตช์เดียวคุมทุกแชต → ปรับโหมดทุกบทสนทนาตามสวิตช์
  await setAllConversationsMode(shopId, value ? "auto" : "manual");

  // เปิด auto: ตอบข้อความที่ลูกค้าทักค้างไว้ให้เลย (ข้อความล่าสุดเป็นของลูกค้า)
  if (value) {
    const convos = await listConversations(shopId);
    const pending = convos.filter((c) => c.lastSender === "customer");
    if (pending.length) {
      const channel = await getChannelByShop(shopId);
      const accessToken = channel?.access_token ?? "";
      after(async () => {
        for (const c of pending) {
          await processAutoReply(shopId, c.id, "", accessToken);
        }
      });
    }
  }

  return NextResponse.json({ autoReply: value });
}
