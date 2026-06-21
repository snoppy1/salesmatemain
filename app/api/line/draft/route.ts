import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getConversation } from "@/lib/inboxRepo";
import { getShopData } from "@/lib/shopRepo";
import { generateReply, ClaudeError } from "@/lib/claude";
import { buildConversationContext } from "@/lib/prompt";

export const runtime = "nodejs";

// ให้ AI ร่างคำตอบสำหรับบทสนทนาที่เลือก (จากประวัติแชต + สินค้า/คู่พ่วงของร้าน)
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { conversationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  if (!body.conversationId) {
    return NextResponse.json({ error: "ระบุบทสนทนา" }, { status: 400 });
  }

  const convo = await getConversation(admin.shopId, body.conversationId);
  if (!convo) {
    return NextResponse.json({ error: "ไม่พบบทสนทนา" }, { status: 404 });
  }
  if (!convo.messages.some((m) => m.sender === "customer")) {
    return NextResponse.json(
      { error: "ยังไม่มีข้อความจากลูกค้าให้ร่างคำตอบ" },
      { status: 400 },
    );
  }

  const shopData = await getShopData(admin.shopId);

  const customerMsg = buildConversationContext(
    convo.customerName,
    convo.channel,
    convo.messages,
  );

  try {
    const result = await generateReply({
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      rules: shopData.rules,
      products: shopData.products,
      customerMsg,
    });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as ClaudeError;
    return NextResponse.json(
      { error: err.message || "ร่างคำตอบไม่สำเร็จ" },
      { status: err.status || 502 },
    );
  }
}
