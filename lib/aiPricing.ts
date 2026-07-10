import "server-only";

/**
 * ราคาโมเดล Anthropic (USD ต่อ 1,000,000 tokens) — อ้างอิงราคาทางการ
 * cache write: 5m TTL = 1.25× ของ input (ฝั่งตอบแชต), 1h TTL = 2× (prewarm)
 * cache read = ~0.1× ของ input
 */
type ModelPrice = {
  input: number;
  output: number;
  cacheWrite5m: number; // 1.25× input
  cacheWrite1h: number; // 2× input
  cacheRead: number; // ~0.1× input
};

const PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
};

// ราคาที่ใช้ถ้าเจอโมเดลที่ไม่รู้จัก (กันคิดเป็น 0 เงียบๆ) — ใช้ Opus (แพงสุด) เป็น worst-case
const FALLBACK_PRICE = PRICES["claude-opus-4-8"];

/** อัตราแลกเปลี่ยน USD→THB (ปรับผ่าน env ได้; freeze ตอนบันทึกจึงไม่กระทบยอดเก่า) */
export function usdToThb(): number {
  const v = Number(process.env.USD_TO_THB);
  return Number.isFinite(v) && v > 0 ? v : 34;
}

export type AiUsage = {
  inputTokens: number; // token ที่ไม่ได้แคช (จ่ายเต็ม)
  outputTokens: number;
  cacheWriteTokens: number; // cache_creation_input_tokens
  cacheReadTokens: number; // cache_read_input_tokens
};

/** แกะ usage จาก response ของ Anthropic (คีย์อาจไม่ครบ → 0) */
export function extractUsage(u: Record<string, unknown> | null | undefined): AiUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: n(u?.input_tokens),
    outputTokens: n(u?.output_tokens),
    cacheWriteTokens: n(u?.cache_creation_input_tokens),
    cacheReadTokens: n(u?.cache_read_input_tokens),
  };
}

/** ต้นทุนจริงของ 1 การเรียก (บาท) จากราคาโมเดล + อัตราแลกเปลี่ยนปัจจุบัน
 *  cacheTtl: ฝั่งตอบแชตใช้ "5m" (1.25×), prewarm ใช้ "1h" (2×) — ไม่ระบุ = 1h (worst-case เดิม) */
export function costThb(model: string, usage: AiUsage, cacheTtl: "5m" | "1h" = "1h"): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheWriteTokens * (cacheTtl === "5m" ? p.cacheWrite5m : p.cacheWrite1h) +
      usage.cacheReadTokens * p.cacheRead) /
    1_000_000;
  return usd * usdToThb();
}

/** ค่า "เขียนแคช" ล้วนๆ (บาท) จากจำนวน token ที่เขียน แยกตาม TTL — ใช้แสดงแยกในหน้าแอดมิน */
export function cacheWriteCostThb(model: string, tokens5m: number, tokens1h: number): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  return ((tokens5m * p.cacheWrite5m + tokens1h * p.cacheWrite1h) / 1_000_000) * usdToThb();
}
