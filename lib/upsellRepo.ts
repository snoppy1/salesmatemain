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
};

/** เหตุการณ์พ่วงที่ยังไม่ถูกแมตช์ว่าขายได้ (ภายในช่วง sinceMs) */
export async function listUnsoldUpsells(shopId: string, sinceMs: number): Promise<UnsoldUpsell[]> {
  const rows = await query<{ id: string; conversation_id: string; channel: string; product: string }>(
    `SELECT id, conversation_id, channel, product
       FROM upsell_events
      WHERE shop_id = $1 AND created_at >= $2 AND sold = false AND product <> ''`,
    [shopId, sinceMs],
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    channel: r.channel,
    product: r.product,
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
