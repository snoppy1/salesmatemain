import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";
import { costThb, extractUsage, type AiUsage } from "./aiPricing";

/** บันทึกต้นทุนจริง 1 การเรียก (best-effort — AI ห้ามล้มเพราะบันทึกต้นทุนไม่ได้) */
export async function recordAiUsage(
  shopId: string,
  model: string,
  kind: "reply" | "choices" | "order" | "prewarm",
  usage: AiUsage,
): Promise<void> {
  // ไม่มี token เลย (เช่นเรียกล้มก่อนคิดเงิน) → ไม่ต้องบันทึก
  if (
    usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens ===
    0
  ) {
    return;
  }
  try {
    await query(
      `INSERT INTO ai_usage
         (id, shop_id, model, kind, in_tokens, out_tokens, cache_write, cache_read, cost_thb, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        newId(),
        shopId,
        model,
        kind,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheWriteTokens,
        usage.cacheReadTokens,
        costThb(model, usage),
        Date.now(),
      ],
    );
  } catch (e) {
    console.error("[aiUsage] record failed:", e instanceof Error ? e.message : e);
  }
}

/** สะดวก: บันทึกจาก response ดิบของ Anthropic (แกะ usage ให้เอง) */
export async function recordUsageFromResponse(
  shopId: string | undefined,
  model: string,
  kind: "reply" | "choices" | "order" | "prewarm",
  usageRaw: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!shopId) return; // ไม่รู้ว่าเป็นร้านไหน → ข้าม (ไม่ทำให้ AI ล้ม)
  await recordAiUsage(shopId, model, kind, extractUsage(usageRaw));
}

/** ต้นทุนรวม (บาท) ของร้านหนึ่งตั้งแต่ sinceMs */
export async function costForShopSince(shopId: string, sinceMs: number): Promise<number> {
  const row = await queryOne<{ c: number }>(
    "SELECT COALESCE(SUM(cost_thb), 0)::float8 AS c FROM ai_usage WHERE shop_id = $1 AND created_at >= $2",
    [shopId, sinceMs],
  );
  return Number(row?.c ?? 0);
}

/** ต้นทุนรวมทุกร้าน (บาท) ตั้งแต่ sinceMs — สำหรับการ์ดรวมในหน้าแอดมิน */
export async function totalCostSince(sinceMs: number): Promise<number> {
  const row = await queryOne<{ c: number }>(
    "SELECT COALESCE(SUM(cost_thb), 0)::float8 AS c FROM ai_usage WHERE created_at >= $1",
    [sinceMs],
  );
  return Number(row?.c ?? 0);
}

/** ต้นทุนต่อร้าน (บาท) ตั้งแต่ sinceMs → Map(shopId → บาท) — คิวรีเดียวสำหรับตารางแอดมิน */
export async function costByShopSince(sinceMs: number): Promise<Map<string, number>> {
  const rows = await query<{ shop_id: string; c: number }>(
    "SELECT shop_id, COALESCE(SUM(cost_thb), 0)::float8 AS c FROM ai_usage WHERE created_at >= $1 GROUP BY shop_id",
    [sinceMs],
  );
  return new Map(rows.map((r) => [r.shop_id, Number(r.c)]));
}

/** การใช้โมเดล AI แยกตาม (ร้าน, โมเดล) ตั้งแต่ sinceMs — สำหรับหน้าดูโมเดลในแอดมิน */
export type ModelUsageRow = {
  shopId: string;
  model: string;
  replies: number; // จำนวนครั้งที่ตอบลูกค้า (ไม่นับ prewarm อุ่นแคช)
  replyCostThb: number; // ต้นทุนของการตอบ
  prewarmCostThb: number; // ต้นทุนอุ่นแคช
  totalCostThb: number; // รวมทั้งหมด
};

export async function modelUsageRowsSince(sinceMs: number): Promise<ModelUsageRow[]> {
  const rows = await query<{
    shop_id: string;
    model: string;
    replies: number;
    reply_cost: number;
    prewarm_cost: number;
    total_cost: number;
  }>(
    `SELECT shop_id, model,
        count(*) FILTER (WHERE kind <> 'prewarm')::int AS replies,
        COALESCE(sum(cost_thb) FILTER (WHERE kind <> 'prewarm'), 0)::float8 AS reply_cost,
        COALESCE(sum(cost_thb) FILTER (WHERE kind = 'prewarm'), 0)::float8 AS prewarm_cost,
        COALESCE(sum(cost_thb), 0)::float8 AS total_cost
       FROM ai_usage
      WHERE created_at >= $1
      GROUP BY shop_id, model`,
    [sinceMs],
  );
  return rows.map((r) => ({
    shopId: r.shop_id,
    model: r.model,
    replies: Number(r.replies),
    replyCostThb: Number(r.reply_cost),
    prewarmCostThb: Number(r.prewarm_cost),
    totalCostThb: Number(r.total_cost),
  }));
}
