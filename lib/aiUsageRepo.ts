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
        // ทุกเส้นทางเขียนแคชแบบ 1 ชม. (2×) แล้ว — กันจุดเตาซ้ำซ้อนระหว่างแชตกับ prewarm
        costThb(model, usage, "1h"),
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

/** ร้านที่แคชของโมเดลนี้ยังอุ่นอยู่ (มีการอ่าน/เขียนใน sinceMs) — prewarm จะเป็น "อ่านต่ออายุ" ถูกๆ แน่นอน
 *  แคชตายแล้วห้ามให้ prewarm จุดเอง (จ่าย 2x ทิ้งบ่อย) — ให้ข้อความจริงถัดไปเป็นคนจุด */
export async function shopsCacheAliveSince(sinceMs: number, model: string): Promise<Set<string>> {
  const rows = await query<{ shop_id: string }>(
    `SELECT DISTINCT shop_id FROM ai_usage
      WHERE created_at >= $1 AND model = $2 AND (cache_write > 0 OR cache_read > 0)`,
    [sinceMs, model],
  );
  return new Set(rows.map((r) => r.shop_id));
}

/** ร้านที่ถูกอุ่นแคชไปแล้วตั้งแต่ sinceMs — ใช้กัน prewarm ยิงซ้ำถี่ๆ (เคยเจอ 4 ครั้ง/นาที) */
export async function shopsWarmedSince(sinceMs: number): Promise<Set<string>> {
  const rows = await query<{ shop_id: string }>(
    "SELECT DISTINCT shop_id FROM ai_usage WHERE kind = 'prewarm' AND created_at >= $1",
    [sinceMs],
  );
  return new Set(rows.map((r) => r.shop_id));
}

export type DailyCacheWriteRow = {
  day: string; // YYYY-MM-DD (เวลาไทย)
  shopId: string;
  model: string;
  chatWrites: number; // จุดแคชจากข้อความแชต (5m TTL)
  prewarmWrites: number; // จุดแคชจากระบบอุ่น (1h TTL)
  w5mTokens: number; // token ที่เขียนฝั่งแชต
  w1hTokens: number; // token ที่เขียนฝั่งอุ่น
};

/** จำนวนครั้ง "จุดแคชใหม่" รายวัน แยกร้าน/โมเดล — ตัวชี้สุขภาพแคช (จุดบ่อยผิดปกติ = มีอะไรล้างแคช) */
export async function dailyCacheWriteRows(sinceMs: number): Promise<DailyCacheWriteRow[]> {
  const rows = await query<{
    shop_id: string;
    model: string;
    day: string;
    chat_writes: number;
    prewarm_writes: number;
    w5m: string;
    w1h: string;
  }>(
    `SELECT shop_id, model,
            to_char(to_timestamp(created_at / 1000) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
            count(*) FILTER (WHERE cache_write > 1000 AND kind NOT IN ('prewarm', 'import'))::int AS chat_writes,
            count(*) FILTER (WHERE cache_write > 1000 AND kind = 'prewarm')::int AS prewarm_writes,
            COALESCE(sum(cache_write) FILTER (WHERE kind NOT IN ('prewarm', 'import')), 0)::bigint AS w5m,
            COALESCE(sum(cache_write) FILTER (WHERE kind = 'prewarm'), 0)::bigint AS w1h
       FROM ai_usage
      WHERE created_at >= $1
      GROUP BY shop_id, model, day`,
    [sinceMs],
  );
  return rows.map((r) => ({
    day: r.day,
    shopId: r.shop_id,
    model: r.model,
    chatWrites: Number(r.chat_writes),
    prewarmWrites: Number(r.prewarm_writes),
    w5mTokens: Number(r.w5m),
    w1hTokens: Number(r.w1h),
  }));
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
  replyCostThb: number; // ต้นทุนตอบแท้ๆ ต่อข้อความ (input+output+อ่านแคช) — ไม่รวมค่าเขียนแคช
  imports: number; // จำนวนงานนำเข้าสินค้า (ย่อคำอธิบาย/สกัดข้อมูล — เกิดตอนดึงสินค้าเข้า ไม่ใช่แชต)
  importCostThb: number; // ต้นทุนงานนำเข้า
  prewarmCostThb: number; // ต้นทุนอุ่นแคช (รวมค่าจุดของระบบอุ่นเอง)
  cacheWriteCostThb: number; // ค่า "เขียนแคชใหม่" ที่เกิดจากข้อความแชต (แยกออกจากต้นทุนตอบแล้ว)
  coldWrites: number; // จำนวนครั้งที่ข้อความแชตต้องจุดแคชใหม่
  totalCostThb: number; // รวมทั้งหมด (ตอบ+นำเข้า+อุ่น+เขียน)
};

export async function modelUsageRowsSince(sinceMs: number): Promise<ModelUsageRow[]> {
  const rows = await query<{
    shop_id: string;
    model: string;
    replies: number;
    r_in: string;
    r_out: string;
    r_read: string;
    imports: number;
    import_cost: number;
    prewarm_cost: number;
    w5m_tokens: string;
    cold_writes: number;
    total_cost: number;
  }>(
    `SELECT shop_id, model,
        count(*) FILTER (WHERE kind NOT IN ('prewarm', 'import'))::int AS replies,
        COALESCE(sum(in_tokens) FILTER (WHERE kind NOT IN ('prewarm', 'import')), 0)::bigint AS r_in,
        COALESCE(sum(out_tokens) FILTER (WHERE kind NOT IN ('prewarm', 'import')), 0)::bigint AS r_out,
        COALESCE(sum(cache_read) FILTER (WHERE kind NOT IN ('prewarm', 'import')), 0)::bigint AS r_read,
        count(*) FILTER (WHERE kind = 'import')::int AS imports,
        COALESCE(sum(cost_thb) FILTER (WHERE kind = 'import'), 0)::float8 AS import_cost,
        COALESCE(sum(cost_thb) FILTER (WHERE kind = 'prewarm'), 0)::float8 AS prewarm_cost,
        COALESCE(sum(cache_write) FILTER (WHERE kind NOT IN ('prewarm', 'import')), 0)::bigint AS w5m_tokens,
        count(*) FILTER (WHERE cache_write > 1000 AND kind NOT IN ('prewarm', 'import'))::int AS cold_writes,
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
    // ต้นทุนตอบแท้ๆ คิดจาก token จริง (ไม่รวมเขียนแคช — แยกแสดงเป็นคอลัมน์ของตัวเอง)
    replyCostThb: costThb(r.model, {
      inputTokens: Number(r.r_in),
      outputTokens: Number(r.r_out),
      cacheWriteTokens: 0,
      cacheReadTokens: Number(r.r_read),
    }),
    imports: Number(r.imports),
    importCostThb: Number(r.import_cost),
    prewarmCostThb: Number(r.prewarm_cost),
    cacheWriteCostThb: cacheWriteCostThb(r.model, 0, Number(r.w5m_tokens)),
    coldWrites: Number(r.cold_writes),
    totalCostThb: Number(r.total_cost),
  }));
}
