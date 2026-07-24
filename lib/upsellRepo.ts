import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

/** ต้นเดือนปัจจุบันเป็น epoch ms (อิงเวลาไทย UTC+7) */
export function monthStart(now: number, tzOffsetHours = 7): number {
  const shifted = new Date(now + tzOffsetHours * 3600_000);
  const localMonthStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1, 0, 0, 0);
  return localMonthStart - tzOffsetHours * 3600_000;
}

/** บันทึก 1 เหตุการณ์การพ่วง (กันนับซ้ำ: บทสนทนา+สินค้าเดียวกัน นับครั้งเดียว) */
export async function recordUpsell(e: {
  shopId: string;
  conversationId: string;
  channel: string;
  product: string;
  estValue: number | null;
}): Promise<void> {
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM upsell_events
       WHERE shop_id = $1 AND conversation_id = $2 AND product = $3 LIMIT 1`,
    [e.shopId, e.conversationId, e.product],
  );
  if (dup) return; // เคยนับพ่วงตัวนี้ในบทสนทนานี้แล้ว → ไม่นับซ้ำ
  await query(
    `INSERT INTO upsell_events (id, shop_id, conversation_id, channel, product, est_value, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId(), e.shopId, e.conversationId, e.channel, e.product, e.estValue, Date.now()],
  );
}

/** สรุปจำนวนครั้ง + มูลค่ารวมที่เสนอพ่วง ตั้งแต่ sinceMs */
export async function upsellSummary(
  shopId: string,
  sinceMs: number,
): Promise<{ count: number; totalEstValue: number }> {
  const row = await queryOne<{ count: number; total: number | null }>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(est_value),0)::int AS total
       FROM upsell_events WHERE shop_id = $1 AND created_at >= $2`,
    [shopId, sinceMs],
  );
  return { count: Number(row?.count ?? 0), totalEstValue: Number(row?.total ?? 0) };
}

export type UnsoldUpsell = {
  id: string;
  conversationId: string;
  channel: string;
  product: string;
  createdAt: number; // เวลาเสนอ — ใช้เทียบว่าออเดอร์เกิด "หลัง" เสนอ
};

/** เหตุการณ์พ่วงที่ยังไม่ถูกแมตช์ว่าขายได้ (ภายในช่วง sinceMs) */
export async function listUnsoldUpsells(shopId: string, sinceMs: number): Promise<UnsoldUpsell[]> {
  const rows = await query<{
    id: string;
    conversation_id: string;
    channel: string;
    product: string;
    created_at: string;
  }>(
    `SELECT id, conversation_id, channel, product, created_at
       FROM upsell_events
      WHERE shop_id = $1 AND created_at >= $2 AND sold = false AND product <> ''`,
    [shopId, sinceMs],
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    channel: r.channel,
    product: r.product,
    createdAt: Number(r.created_at),
  }));
}

/** จำนวน "การ์ดสินค้า" ที่ส่งให้ลูกค้า รายวันรายร้าน — ขากลางของกรวย เสนอ→เห็นของ→ซื้อ
 *  (นับจากข้อความ [การ์ดสินค้า] ที่ระบบบันทึกตอนส่งการ์ดจริงสำเร็จ) */
export async function dailyCardSendsByShop(
  sinceMs: number,
): Promise<{ day: string; shopId: string; cards: number }[]> {
  const rows = await query<{ shop_id: string; day: string; cards: number }>(
    `SELECT c.shop_id,
            to_char(to_timestamp(m.created_at / 1000) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS cards
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.created_at >= $1 AND m.ai_generated = true AND m.text LIKE '[การ์ดสินค้า]%'
      GROUP BY c.shop_id, day`,
    [sinceMs],
  );
  return rows.map((r) => ({ day: r.day, shopId: r.shop_id, cards: Number(r.cards) }));
}

/** ร้านที่มีพ่วง Lazada ค้างรอแมตช์ (ยังไม่ sold) ในช่วง sinceMs — ให้ cron ไล่แมตช์อัตโนมัติ */
export async function shopsWithUnsoldLazadaUpsells(sinceMs: number): Promise<string[]> {
  const rows = await query<{ shop_id: string }>(
    `SELECT DISTINCT shop_id FROM upsell_events
      WHERE sold = false AND channel = 'lazada' AND product <> '' AND created_at >= $1`,
    [sinceMs],
  );
  return rows.map((r) => r.shop_id);
}

export type UnmatchedCard = {
  messageId: string;
  product: string; // ชื่อสินค้าบนการ์ด (ข้อความหลัง "[การ์ดสินค้า] ")
  createdAt: number;
};

/** การ์ดสินค้า (Lazada) ที่ยังไม่ถูกแมตช์กับออเดอร์ ในช่วง sinceMs */
export async function listUnmatchedCardSends(shopId: string, sinceMs: number): Promise<UnmatchedCard[]> {
  const rows = await query<{ id: string; text: string; created_at: string }>(
    `SELECT m.id, m.text, m.created_at
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.shop_id = $1 AND c.channel = 'lazada' AND m.ai_generated = true
        AND m.text LIKE '[การ์ดสินค้า]%' AND m.created_at >= $2
        AND NOT EXISTS (SELECT 1 FROM assist_matches am WHERE am.message_id = m.id)`,
    [shopId, sinceMs],
  );
  return rows
    .map((r) => ({
      messageId: r.id,
      product: r.text.replace(/^\[การ์ดสินค้า\]\s*/, "").trim(),
      createdAt: Number(r.created_at),
    }))
    .filter((r) => r.product !== "");
}

/** บันทึกแมตช์ "AI มีส่วนช่วย" — คืน true ถ้าเป็นรายการใหม่ (ออเดอร์+สินค้านี้ยังไม่เคยนับ) */
export async function recordAssistMatch(m: {
  shopId: string;
  messageId: string;
  product: string;
  itemName: string;
  orderId: string;
  soldValue: number;
  cardAt: number;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO assist_matches (id, shop_id, message_id, product, item_name, order_id, sold_value, card_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (shop_id, order_id, item_name) DO NOTHING
     RETURNING id`,
    [newId(), m.shopId, m.messageId, m.product, m.itemName, m.orderId, Math.round(m.soldValue), m.cardAt, Date.now()],
  );
  return rows.length > 0;
}

/** ร้านที่มีการ์ด Lazada ยังไม่แมตช์ในช่วง sinceMs — ให้ cron ไล่แมตช์ */
export async function shopsWithUnmatchedLazadaCards(sinceMs: number): Promise<string[]> {
  const rows = await query<{ shop_id: string }>(
    `SELECT DISTINCT c.shop_id
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.channel = 'lazada' AND m.ai_generated = true
        AND m.text LIKE '[การ์ดสินค้า]%' AND m.created_at >= $1
        AND NOT EXISTS (SELECT 1 FROM assist_matches am WHERE am.message_id = m.id)`,
    [sinceMs],
  );
  return rows.map((r) => r.shop_id);
}

export type DailyAssistRow = { day: string; shopId: string; assisted: number; assistedValue: number };

/** ยอด "AI มีส่วนช่วย" รายวันรายร้าน (นับตามวันที่ส่งการ์ด) */
export async function dailyAssistByShop(sinceMs: number): Promise<DailyAssistRow[]> {
  const rows = await query<{ shop_id: string; day: string; n: number; total: number }>(
    `SELECT shop_id,
            to_char(to_timestamp(card_at / 1000) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS n, COALESCE(SUM(sold_value), 0)::int AS total
       FROM assist_matches
      WHERE card_at >= $1
      GROUP BY shop_id, day`,
    [sinceMs],
  );
  return rows.map((r) => ({
    day: r.day,
    shopId: r.shop_id,
    assisted: Number(r.n),
    assistedValue: Number(r.total),
  }));
}

/** ทำเครื่องหมายว่าพ่วงนี้ขายได้จริง (จากการแมตช์ออเดอร์) */
export async function markUpsellSold(id: string, soldValue: number, orderId: string): Promise<void> {
  await query(
    "UPDATE upsell_events SET sold = true, sold_value = $1, matched_order_id = $2 WHERE id = $3",
    [Math.round(soldValue), orderId, id],
  );
}

/** สรุปจำนวน + มูลค่าพ่วงที่ขายได้จริง ตั้งแต่ sinceMs */
export async function soldSummary(
  shopId: string,
  sinceMs: number,
): Promise<{ count: number; totalSoldValue: number }> {
  const row = await queryOne<{ count: number; total: number | null }>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(sold_value),0)::int AS total
       FROM upsell_events WHERE shop_id = $1 AND created_at >= $2 AND sold = true`,
    [shopId, sinceMs],
  );
  return { count: Number(row?.count ?? 0), totalSoldValue: Number(row?.total ?? 0) };
}

export type DailyUpsellRow = {
  day: string; // YYYY-MM-DD (เวลาไทย)
  shopId: string;
  offered: number; // AI เสนอพ่วงกี่ครั้ง
  estValue: number; // มูลค่าที่เสนอรวม (ประมาณ — จากราคาตอนเสนอ)
  sold: number; // ปิดได้จริงกี่ครั้ง (แมตช์ออเดอร์แล้ว)
  soldValue: number; // ยอดขายจริงรวม (บาท)
};

/** ยอดพ่วงของ AI รายวัน แยกรายร้าน ตั้งแต่ sinceMs — สำหรับแท็บยอดขายในแอดมิน */
export async function dailyUpsellByShop(sinceMs: number): Promise<DailyUpsellRow[]> {
  const rows = await query<{
    shop_id: string;
    day: string;
    offered: number;
    est_total: number;
    sold: number;
    sold_total: number;
  }>(
    `SELECT shop_id,
            to_char(to_timestamp(created_at / 1000) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS offered,
            COALESCE(SUM(est_value), 0)::int AS est_total,
            COUNT(*) FILTER (WHERE sold = true)::int AS sold,
            COALESCE(SUM(sold_value) FILTER (WHERE sold = true), 0)::int AS sold_total
       FROM upsell_events
      WHERE created_at >= $1
      GROUP BY shop_id, day
      ORDER BY day DESC`,
    [sinceMs],
  );
  return rows.map((r) => ({
    day: r.day,
    shopId: r.shop_id,
    offered: Number(r.offered),
    estValue: Number(r.est_total),
    sold: Number(r.sold),
    soldValue: Number(r.sold_total),
  }));
}

/** ล้างเหตุการณ์พ่วงทั้งหมดของร้าน (รีเซ็ตตอนสลับจาก mock → ของจริง) */
export async function clearUpsells(shopId: string): Promise<void> {
  await query("DELETE FROM upsell_events WHERE shop_id = $1", [shopId]);
}
