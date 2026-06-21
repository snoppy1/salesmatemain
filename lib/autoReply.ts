import "server-only";
import {
  getConversation,
  setPendingHuman,
  addAdminMessage,
} from "./inboxRepo";
import { getShopData } from "./shopRepo";
import { generateReply } from "./claude";
import { buildConversationContext } from "./prompt";
import { replyMessage } from "./lineClient";

/**
 * โหมด auto: AI ร่าง + ประเมินความมั่นใจ
 * - มั่นใจ → ตอบเอง (Reply API ถ้ามี replyToken; แชทจำลองส่ง "" = ไม่ยิงจริง) + บันทึก
 * - ไม่มั่นใจ → ตั้ง "รอตอบ" ให้คนจัดการ
 * ใช้ร่วมกันทั้ง webhook จริงและแชทจำลอง
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
    await replyMessage(accessToken, replyToken, result.message);
    await addAdminMessage(shopId, conversationId, result.message); // เคลียร์ pending ด้วย
  } catch {
    await setPendingHuman(conversationId, true).catch(() => {});
  }
}
