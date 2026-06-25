import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

/** ต้นเดือนปัจจุบันเป็น epoch ms (อิงเวลาไทย UTC+7) */
export function monthStart(now: number, tzOffsetHours = 7): number {
  const shifted = new Date(now + tzOffsetHours * 3600_000);
  const localMonthStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1, 0, 0, 0);
  return localMonthStart - tzOffsetHours * 3600_000;
}

/** บันทึก 1 เหตุการณ์การพ่วงที่ส่งถึงลูกค้าแล้ว */
export async function recordUpsell(e: {
  shopId: string;
  conversationId: string;
  channel: string;
  product: string;
  estValue: number | null;
}): Promise<void> {
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
