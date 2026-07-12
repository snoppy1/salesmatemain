import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getConversation, getSendTarget } from "@/lib/inboxRepo";
import { getShopData } from "@/lib/shopRepo";
import { generateReply, generateReplyWithTools, ClaudeError, type ReplyResult } from "@/lib/claude";
import { buildConversationContext } from "@/lib/prompt";
import { listPromotions } from "@/lib/promotionsRepo";
import { validNowPromotions } from "@/lib/promotions";
import { isOrderTopic, needsHumanForOrderTopic } from "@/lib/orderIntent";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { recordUpsell } from "@/lib/upsellRepo";

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
  const promotions = validNowPromotions(await listPromotions(admin.shopId), Date.now());

  const ctx = buildConversationContext(
    convo.customerName,
    convo.channel,
    convo.messages,
  );

  const lastCustomerText =
    [...convo.messages].reverse().find((m) => m.sender === "customer")?.text ?? "";
  const baseReq = {
    shopId: admin.shopId,
    shopName: shopData.shop.name,
    shopVoice: shopData.shop.voice,
    shopMemory: shopData.shop.memory,
    shopGender: shopData.shop.gender,
    products: shopData.products,
    promotions,
    customerMsg: ctx.text,
    imageUrls: ctx.imageUrls,
  };

  try {
    let result: ReplyResult;
    if (isOrderTopic(lastCustomerText)) {
      const target = await getSendTarget(admin.shopId, body.conversationId);
      const token = (await getValidAccessToken(admin.shopId, "lazada")) ?? "mock-lazada";
      const buyerId = convo.channel === "lazada" ? target?.lineUserId ?? null : null;
      result = await generateReplyWithTools(baseReq, { token, buyerId, channel: convo.channel });
    } else {
      result = await generateReply(baseReq);
    }
    if (needsHumanForOrderTopic(lastCustomerText)) {
      result = { ...result, needsHuman: true };
    }
    // นับ "AI เสนอพ่วง" ตอน AI ร่างคำตอบที่มีพ่วง (โหมดกดส่งเอง) — recordUpsell กันนับซ้ำให้แล้ว
    if (result.shouldUpsell) {
      await recordUpsell({
        shopId: admin.shopId,
        conversationId: body.conversationId,
        channel: convo.channel,
        product: result.upsellProduct,
        estValue: result.estAddedValue,
      }).catch(() => {});
    }
    return NextResponse.json(result);
  } catch (e) {
    const err = e as ClaudeError;
    return NextResponse.json(
      { error: err.message || "ร่างคำตอบไม่สำเร็จ" },
      { status: err.status || 502 },
    );
  }
}
