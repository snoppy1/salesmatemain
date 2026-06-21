import "server-only";
import {
  getConversation,
  setPendingHuman,
  addAdminMessage,
  getSendTarget,
} from "./inboxRepo";
import { getShopData } from "./shopRepo";
import { generateReply } from "./claude";
import { buildConversationContext } from "./prompt";
import { replyMessage, pushMessage } from "./lineClient";

/**
 * โหมด auto: AI ร่าง + ประเมินความมั่นใจ
 * - มั่นใจ → ตอบเอง แล้วบันทึก
 *   - มี replyToken (webhook) → Reply API (ฟรี)
 *   - ไม่มี replyToken (กดสลับเป็น auto / แชทจำลอง) → Push API
 * - ไม่มั่นใจ → ตั้ง "รอตอบ" ให้คนจัดการ
 * ใช้ร่วมกันทั้ง webhook จริง, กดสลับโหมด, และแชทจำลอง
 */
export async function processAutoReply(
  shopId: string,
  conversationId: string,
  replyToken: string,
  accessToken: string,
): Promise<void> {
  try {
    const convo = await getConversation(shopId, conversationId);
    if (!convo) return;
    const shopData = await getShopData(shopId);
    const customerMsg = buildConversationContext(
      convo.customerName,
      convo.channel,
      convo.messages,
    );
    const result = await generateReply({
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      rules: shopData.rules,
      products: shopData.products,
      customerMsg,
    });
    if (result.needsHuman || !result.message.trim()) {
      await setPendingHuman(conversationId, true);
      return;
    }
    if (replyToken) {
      await replyMessage(accessToken, replyToken, result.message);
    } else {
      const target = await getSendTarget(shopId, conversationId);
      await pushMessage(accessToken, target?.lineUserId ?? "", result.message);
    }
    await addAdminMessage(shopId, conversationId, result.message); // เคลียร์ pending ด้วย
  } catch {
    await setPendingHuman(conversationId, true).catch(() => {});
  }
}
