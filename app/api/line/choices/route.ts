import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getConversation } from "@/lib/inboxRepo";
import { getShopData } from "@/lib/shopRepo";
import { generateChoices, ClaudeError } from "@/lib/claude";
import { buildConversationContext } from "@/lib/prompt";
import { listPromotions } from "@/lib/promotionsRepo";
import { validNowPromotions } from "@/lib/promotions";

export const runtime = "nodejs";

// โหมด manual: ให้ AI เสนอ 2-3 คำตอบให้แอดมินเลือก
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
      { error: "ยังไม่มีข้อความจากลูกค้า" },
      { status: 400 },
    );
  }

  const shopData = await getShopData(admin.shopId);
  const promotions = validNowPromotions(await listPromotions(admin.shopId), Date.now());
  const ctx = buildConversationContext(
    convo.customerName,
    convo.channel,
    convo.messages,
  );

  try {
    const choices = await generateChoices({
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      shopMemory: shopData.shop.memory,
      products: shopData.products,
      promotions,
      customerMsg: ctx.text,
      imageUrls: ctx.imageUrls,
    });
    return NextResponse.json({ choices });
  } catch (e) {
    const err = e as ClaudeError;
    return NextResponse.json(
      { error: err.message || "เสนอคำตอบไม่สำเร็จ" },
      { status: err.status || 502 },
    );
  }
}
