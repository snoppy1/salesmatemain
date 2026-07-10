import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";
import { costThb, cacheWriteCostThb, extractUsage, type AiUsage } from "./aiPricing";

export type UsageKind = "reply" | "choices" | "order" | "prewarm" | "import";

/** บันทึกต้นทุนจริง 1 การเรียก (best-effort — AI ห้ามล้มเพราะบันทึกต้นทุนไม่ได้) */
export async function recordAiUsage(
  shopId: string,
  model: string,
  kind: UsageKind,
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
        // ฝั่งตอบแชตเขียนแคชแบบ 5 นาที (1.25×) — มีแต่ prewarm ที่ใช้ 1 ชม. (2×)
        costThb(model, usage, kind === "prewarm" ? "1h" : "5m"),
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
  kind: UsageKind,
  usageRaw: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!shopId) return; // ไม่รู้ว่าเป็นร้านไหน → ข้าม (ไม่ทำให้ AI ล้ม)
  await recordAiUsage(shopId, model, kind, extractUsage(usageRaw));
}

/** ร้านที่ถูกอุ่นแคชไปแล้วตั้งแต่ sinceMs — ใช้กัน prewarm ยิงซ้ำถี่ๆ (เคยเจอ 4 ครั้ง/นาที) */
export async function shopsWarmedSince(sinceMs: number): Promise<Set<string>> {
  const rows = await query<{ shop_id: string }>(
    "SELECT DISTINCT shop_id FROM ai_usage WHERE kind = 'prewarm' AND created_at >= $1",
    [sinceMs],
  );
  return new Set(rows.map((r) => r.shop_id));
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
  replies: number; // จำนวนครั้งที่ตอบลูกค้า (ไม่นับ prewarm/นำเข้า)
  replyCostThb: number; // ต้นทุนของการตอบ
  imports: number; // จำนวนงานนำเข้าสินค้า (ย่อคำอธิบาย/สกัดข้อมูล — เกิดตอนดึงสินค้าเข้า ไม่ใช่แชต)
  importCostThb: number; // ต้นทุนงานนำเข้า
  prewarmCostThb: number; // ต้นทุนอุ่นแคช
  cacheWriteCostThb: number; // ค่า "เขียนแคชใหม่" ล้วนๆ (ส่วนหนึ่งของต้นทุนตอบ+อุ่น ไม่ใช่ยอดบวกเพิ่ม)
  coldWrites: number; // จำนวนครั้งที่ต้องจุดแคชใหม่ (เขียนก้อนใหญ่)
  totalCostThb: number; // รวมทั้งหมด
};

export async function modelUsageRowsSince(sinceMs: number): Promise<ModelUsageRow[]> {
  const rows = await query<{
    shop_id: string;
    model: string;
    replies: number;
    reply_cost: number;
    imports: number;
    import_cost: number;
    prewarm_cost: number;
    w5m_tokens: string;
    w1h_tokens: string;
    cold_writes: number;
    total_cost: number;
  }>(
    `SELECT shop_id, model,
        count(*) FILTER (WHERE kind NOT IN ('prewarm', 'import'))::int AS replies,
        COALESCE(sum(cost_thb) FILTER (WHERE kind NOT IN ('prewarm', 'import')), 0)::float8 AS reply_cost,
        count(*) FILTER (WHERE kind = 'import')::int AS imports,
        COALESCE(sum(cost_thb) FILTER (WHERE kind = 'import'), 0)::float8 AS import_cost,
        COALESCE(sum(cost_thb) FILTER (WHERE kind = 'prewarm'), 0)::float8 AS prewarm_cost,
        COALESCE(sum(cache_write) FILTER (WHERE kind <> 'prewarm'), 0)::bigint AS w5m_tokens,
        COALESCE(sum(cache_write) FILTER (WHERE kind = 'prewarm'), 0)::bigint AS w1h_tokens,
        count(*) FILTER (WHERE cache_write > 1000)::int AS cold_writes,
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
    imports: Number(r.imports),
    importCostThb: Number(r.import_cost),
    prewarmCostThb: Number(r.prewarm_cost),
    cacheWriteCostThb: cacheWriteCostThb(r.model, Number(r.w5m_tokens), Number(r.w1h_tokens)),
    coldWrites: Number(r.cold_writes),
    totalCostThb: Number(r.total_cost),
  }));
}
