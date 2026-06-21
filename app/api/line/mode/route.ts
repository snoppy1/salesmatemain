import { NextResponse, after } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { setMode, getConversation } from "@/lib/inboxRepo";
import { getChannelByShop } from "@/lib/lineChannelRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

// override โหมดรายบทสนทนา (auto/manual)
// ถ้าเปลี่ยนเป็น auto แล้วข้อความล่าสุดเป็นของลูกค้า (ยังไม่ตอบ) → ให้ AI ตอบให้เลย
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { conversationId?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const mode = body.mode === "auto" ? "auto" : "manual";
  if (!body.conversationId) {
    return NextResponse.json({ error: "ระบุบทสนทนา" }, { status: 400 });
  }
  const conversationId = body.conversationId;
  await setMode(admin.shopId, conversationId, mode);

  if (mode === "auto") {
    const convo = await getConversation(admin.shopId, conversationId);
    const last = convo?.messages[convo.messages.length - 1];
    if (last && last.sender === "customer") {
      const channel = await getChannelByShop(admin.shopId);
      const accessToken = channel?.access_token ?? "";
      const shopId = admin.shopId;
      after(() => processAutoReply(shopId, conversationId, "", accessToken));
    }
  }

  return NextResponse.json({ ok: true, mode });
}
