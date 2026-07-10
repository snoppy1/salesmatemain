import "server-only";
import {
  getConversation,
  setPendingHuman,
  addAdminMessage,
  getSendTarget,
  latestCustomerMessageAt,
  adminRepliedAfter,
} from "./inboxRepo";
import { getShopData } from "./shopRepo";
import { generateReply, generateReplyWithTools, type ReplyResult } from "./claude";
import { buildConversationContext } from "./prompt";
import { listPromotions } from "./promotionsRepo";
import { validNowPromotions } from "./promotions";
import { isOrderTopic, needsHumanForOrderTopic } from "./orderIntent";
import { isMostlyEnglish } from "./lang";
import { queryOne } from "./db";
import { bangkokDayStartMs } from "./adminStats";
import { getValidAccessToken } from "./connectionRepo";
import { recordUpsell } from "./upsellRepo";
import { replyMessage, pushMessage } from "./lineClient";
import { sendMessage as fbSendMessage } from "./facebookClient";
import { sendMessage as ttSendMessage } from "./tiktokClient";
import { sendMessage as lzSendMessage, sendItemCard as lzSendItemCard } from "./lazadaChatClient";
import { pickMentionedLazadaProducts } from "./productCards";
import { sendMessage as spSendMessage } from "./shopeeChatClient";
import { getChannelByShop as getLineChannel } from "./lineChannelRepo";
import { getChannelByShop as getFbChannel } from "./facebookChannelRepo";
import { getChannelByShop as getTtChannel } from "./tiktokChannelRepo";
import { getChannelByShop as getLzChannel } from "./lazadaChannelRepo";
import { getChannelByShop as getSpChannel } from "./shopeeChannelRepo";

/** หน่วงก่อน AI ตอบ (วินาที×1000) — เผื่อลูกค้าพิมพ์ต่อเป็นท่อนๆ + เผื่อเวลาแอดมินแทรกเอง; ตั้ง 0 = ตอบทันที */
const AUTO_REPLY_DELAY_MS = Number(process.env.AUTO_REPLY_DELAY_MS ?? 10000);

/**
 * ตอบอัตโนมัติแบบ debounce (เรียกจาก webhook ที่ลูกค้าทักเข้ามาจริง):
 * รอ ~10 วิ แล้วค่อยตอบ — ถ้าระหว่างรอ (1) ลูกค้าพิมพ์เพิ่ม → ให้ข้อความใหม่เป็นคนตอบ (กันตอบทีละท่อน)
 * หรือ (2) แอดมินแทรกตอบเอง → AI ไม่ต้องตอบซ้ำ. ตอบครั้งเดียวรวมทุกท่อน (processAutoReply อ่านทั้งบทสนทนาอยู่แล้ว)
 */
export async function scheduleAutoReply(
  shopId: string,
  conversationId: string,
  replyToken: string,
): Promise<void> {
  const triggerAt = await latestCustomerMessageAt(conversationId);
  if (triggerAt == null) return; // ไม่มีข้อความลูกค้า — ไม่ต้องตอบ
  if (AUTO_REPLY_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, AUTO_REPLY_DELAY_MS));
    // ลูกค้าพิมพ์เพิ่มระหว่างรอ → webhook ของข้อความใหม่จะรับหน้าที่ตอบเอง (debounce)
    const latest = await latestCustomerMessageAt(conversationId);
    if (latest != null && latest > triggerAt) return;
    // แอดมินแทรกตอบเองระหว่างรอ → ไม่ตอบซ้ำ
    if (await adminRepliedAfter(conversationId, triggerAt)) return;
  }
  await processAutoReply(shopId, conversationId, replyToken);
}

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
    const ctx = buildConversationContext(
      convo.customerName,
      convo.channel,
      convo.messages,
    );
    const promotions = validNowPromotions(await listPromotions(shopId), Date.now());

    // ข้อความล่าสุดของลูกค้า (ใช้เช็คว่าเป็นคำถามออเดอร์ไหม)
    const lastCustomerText =
      [...convo.messages].reverse().find((m) => m.sender === "customer")?.text ?? "";

    // ยังไม่รองรับภาษาอังกฤษ — ลูกค้าถามเป็นอังกฤษ → ไม่ให้ AI ตอบ ขึ้น "รอตอบ" ให้คนจัดการ
    // (ไม่เรียก AI เลย = ไม่เสียเครดิตด้วย)
    if (isMostlyEnglish(lastCustomerText)) {
      await setPendingHuman(conversationId, true);
      return;
    }

    // เพดานข้อความ AI ต่อร้านต่อวัน — กันยิงถล่ม (bot/fuzzing เช่นช่วง pen test) เผาเครดิต
    // ตั้งสูงกว่าการใช้จริงหลายเท่า ร้านปกติไม่มีทางชน; ชนแล้วข้อความขึ้น "รอตอบ" แทน
    const AI_DAILY_CAP = Number(process.env.AI_DAILY_CAP || 200);
    const used = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.shop_id = $1 AND m.ai_generated = true AND m.created_at >= $2
          AND m.text NOT LIKE '[การ์ดสินค้า]%'`, // การ์ดสินค้าไม่ได้เรียก AI — ไม่กินโควตา
      [shopId, bangkokDayStartMs()],
    );
    if (Number(used?.n ?? 0) >= AI_DAILY_CAP) {
      await setPendingHuman(conversationId, true);
      return;
    }

    const baseReq = {
      shopId,
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
    const target = await getSendTarget(shopId, conversationId);
    const extUserId = target?.lineUserId ?? "";
    let lzMessageId = ""; // message_id จาก Lazada — เก็บเป็น ext_id กัน webhook echo ซ้ำ
    let lzCardCtx: { token: string; sessionId: string } | null = null; // ส่งการ์ดสินค้าตามหลังข้อความ (เฉพาะ Lazada)

    if (convo.channel === "facebook") {
      const fb = await getFbChannel(shopId);
      await fbSendMessage(fb?.access_token ?? "", extUserId, result.message);
    } else if (convo.channel === "tiktok") {
      const tt = await getTtChannel(shopId);
      await ttSendMessage(tt?.access_token ?? "", extUserId, result.message);
    } else if (convo.channel === "lazada") {
      const lz = await getLzChannel(shopId);
      // Lazada ส่งด้วย IM session_id จริง (ไม่ใช่ buyer_id)
      const sent = await lzSendMessage(lz?.access_token ?? "", target?.sessionId ?? "", result.message);
      lzMessageId = sent.messageId;
      if (sent.ok) {
        lzCardCtx = { token: lz?.access_token ?? "", sessionId: target?.sessionId ?? "" };
      }
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

    // aiGenerated=true → นับเป็นข้อความที่ AI ตอบ (โควตา/ต้นทุน) + เคลียร์ pending ด้วย
    await addAdminMessage(shopId, conversationId, result.message, lzMessageId || undefined, true);

    // Lazada: ส่ง "การ์ดสินค้า" ของตัวที่ AI เอ่ยถึงตามหลังข้อความ — ลูกค้ากดเปิดหน้าสินค้าได้เลย
    // (feedback: AI แนะนำสินค้าแต่ลูกค้าหาไม่เจอ) best-effort: การ์ดพลาดไม่กระทบข้อความหลักที่ส่งไปแล้ว
    if (lzCardCtx) {
      const cards = pickMentionedLazadaProducts(result.message, result.upsellProduct, shopData.products);
      for (const card of cards) {
        const cs = await lzSendItemCard(lzCardCtx.token, lzCardCtx.sessionId, card.externalId ?? "");
        if (cs.ok) {
          await addAdminMessage(
            shopId, conversationId, `[การ์ดสินค้า] ${card.name}`, cs.messageId || undefined, true,
          ).catch(() => {});
        }
      }
    }

    // วัดยอดพ่วง: บันทึกทุกครั้งที่ AI เสนอพ่วงและส่งถึงลูกค้าแล้ว (นับจำนวนแม้ไม่ได้ใส่ตัวเลขมูลค่า)
    if (result.shouldUpsell) {
      await recordUpsell({
        shopId,
        conversationId,
        channel: convo.channel,
        product: result.upsellProduct,
        estValue: result.estAddedValue,
      }).catch(() => {});
    }

    // ต้องให้แอดมินช่วยต่อ → ส่งข้อความรับเรื่องให้ลูกค้าแล้ว + ตั้ง "รอตอบ" ให้แอดมินตามตอบ
    // (addAdminMessage เคลียร์ pending ไป ต้องตั้งกลับ — กันลูกค้าถูกบอกให้รอแอดมินแต่แอดมินไม่เห็น)
    if (result.needsHuman) {
      await setPendingHuman(conversationId, true);
    }
  } catch {
    await setPendingHuman(conversationId, true).catch(() => {});
  }
}
