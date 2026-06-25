import "server-only";
import {
  getConversation,
  setPendingHuman,
  addAdminMessage,
  getSendTarget,
} from "./inboxRepo";
import { getShopData } from "./shopRepo";
import { getChannelLevel } from "./inboxAppsRepo";
import { generateReply, generateReplyWithTools, type ReplyResult } from "./claude";
import { buildConversationContext } from "./prompt";
import { listPromotions } from "./promotionsRepo";
import { validNowPromotions } from "./promotions";
import { isOrderTopic, needsHumanForOrderTopic } from "./orderIntent";
import { getValidAccessToken } from "./connectionRepo";
import { recordUpsell } from "./upsellRepo";
import { replyMessage, pushMessage } from "./lineClient";
import { sendMessage as fbSendMessage } from "./facebookClient";
import { sendMessage as ttSendMessage } from "./tiktokClient";
import { sendMessage as lzSendMessage } from "./lazadaChatClient";
import { sendMessage as spSendMessage } from "./shopeeChatClient";
import { getChannelByShop as getLineChannel } from "./lineChannelRepo";
import { getChannelByShop as getFbChannel } from "./facebookChannelRepo";
import { getChannelByShop as getTtChannel } from "./tiktokChannelRepo";
import { getChannelByShop as getLzChannel } from "./lazadaChannelRepo";
import { getChannelByShop as getSpChannel } from "./shopeeChannelRepo";

/**
 * โหมด auto: AI ร่าง + ประเมินความมั่นใจ แล้วส่งเองตามช่องทางของบทสนทนา
 * - มั่นใจ → ตอบเอง (LINE: Reply ถ้ามี replyToken ไม่งั้น Push / Facebook: Send API)
 * - ไม่มั่นใจ → ตั้ง "รอตอบ" ให้คนจัดการ
 * resolve access token ตามช่องทางเอง (รองรับ webhook จริง, กดสลับ, แชทจำลอง หลายแพลตฟอร์ม)
 */
export async function processAutoReply(
  shopId: string,
  conversationId: string,
  replyToken: string,
): Promise<void> {
  try {
    const convo = await getConversation(shopId, conversationId);
    if (!convo) return;
    const shopData = await getShopData(shopId);
    const level = await getChannelLevel(shopId, convo.channel);
    // โหมด full → AI ตอบแม้ไม่มั่นใจ (โหมดปลอดภัยจะเด้งรอตอบแทน)
    const fullNow = level === "full";
    const ctx = buildConversationContext(
      convo.customerName,
      convo.channel,
      convo.messages,
    );
    const promotions = validNowPromotions(await listPromotions(shopId), Date.now());

    // ข้อความล่าสุดของลูกค้า (ใช้เช็คว่าเป็นคำถามออเดอร์ไหม)
    const lastCustomerText =
      [...convo.messages].reverse().find((m) => m.sender === "customer")?.text ?? "";

    const baseReq = {
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      shopMemory: shopData.shop.memory,
      products: shopData.products,
      promotions,
      customerMsg: ctx.text,
      imageUrls: ctx.imageUrls,
    };

    let result: ReplyResult;
    if (isOrderTopic(lastCustomerText)) {
      const target = await getSendTarget(shopId, conversationId);
      const token = (await getValidAccessToken(shopId, "lazada")) ?? "mock-lazada";
      const buyerId = convo.channel === "lazada" ? target?.lineUserId ?? null : null;
      result = await generateReplyWithTools(baseReq, { token, buyerId, channel: convo.channel });
    } else {
      result = await generateReply(baseReq);
    }

    // เคลม/ยกเลิก/คืนเงิน → บังคับส่งให้คนตอบเสมอ (แม้ full auto)
    if (needsHumanForOrderTopic(lastCustomerText)) {
      result = { ...result, needsHuman: true };
    }
    // ตอบไม่ออกจริงๆ (ข้อความว่าง) → รอคนเสมอ แม้ full auto (กันส่งข้อความเปล่า)
    if (!result.message.trim()) {
      await setPendingHuman(conversationId, true);
      return;
    }
    // ไม่มั่นใจ + ไม่ใช่ full → รอคนตอบ (โหมดปลอดภัย); ถ้า full → ส่งคำตอบไปเลย
    if (result.needsHuman && !fullNow) {
      await setPendingHuman(conversationId, true);
      return;
    }

    const target = await getSendTarget(shopId, conversationId);
    const extUserId = target?.lineUserId ?? "";

    if (convo.channel === "facebook") {
      const fb = await getFbChannel(shopId);
      await fbSendMessage(fb?.access_token ?? "", extUserId, result.message);
    } else if (convo.channel === "tiktok") {
      const tt = await getTtChannel(shopId);
      await ttSendMessage(tt?.access_token ?? "", extUserId, result.message);
    } else if (convo.channel === "lazada") {
      const lz = await getLzChannel(shopId);
      await lzSendMessage(lz?.access_token ?? "", extUserId, result.message);
    } else if (convo.channel === "shopee") {
      const sp = await getSpChannel(shopId);
      await spSendMessage(
        sp?.access_token ?? "",
        sp?.account_id ?? "",
        extUserId,
        result.message,
      );
    } else {
      const line = await getLineChannel(shopId);
      const accessToken =
        line?.access_token ?? process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
      if (replyToken) {
        await replyMessage(accessToken, replyToken, result.message);
      } else {
        await pushMessage(accessToken, extUserId, result.message);
      }
    }

    await addAdminMessage(shopId, conversationId, result.message); // เคลียร์ pending ด้วย

    // วัดยอดพ่วง: บันทึกเมื่อ AI เสนอพ่วงและส่งถึงลูกค้าแล้ว (best-effort ห้ามทำให้ตอบแชตพัง)
    if (result.shouldUpsell && result.estAddedValue != null) {
      await recordUpsell({
        shopId,
        conversationId,
        channel: convo.channel,
        product: result.upsellProduct,
        estValue: result.estAddedValue,
      }).catch(() => {});
    }

    // Full auto + AI ไม่มั่นใจ: ส่งข้อความ "ขอเช็คแอดมิน" ให้ลูกค้าแล้ว แต่ AI ยังตอบจริงไม่ได้
    // → ตั้ง "รอตอบ" กลับ เพื่อให้แอดมินเห็นว่าต้องตามตอบต่อ (กันลูกค้ารอเก้อ)
    if (result.needsHuman) {
      await setPendingHuman(conversationId, true);
    }
  } catch {
    await setPendingHuman(conversationId, true).catch(() => {});
  }
}
