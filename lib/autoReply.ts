import "server-only";
import {
  getConversation,
  setPendingHuman,
  addAdminMessage,
  getSendTarget,
} from "./inboxRepo";
import { getShopData, getAutoLevel } from "./shopRepo";
import { generateReply } from "./claude";
import { buildConversationContext } from "./prompt";
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
    const level = await getAutoLevel(shopId);
    // โหมด full → AI ตอบแม้ไม่มั่นใจ (โหมดปลอดภัยจะเด้งรอตอบแทน)
    const fullNow = level === "full";
    const customerMsg = buildConversationContext(
      convo.customerName,
      convo.channel,
      convo.messages,
    );
    const result = await generateReply({
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      products: shopData.products,
      customerMsg,
    });
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
  } catch {
    await setPendingHuman(conversationId, true).catch(() => {});
  }
}
