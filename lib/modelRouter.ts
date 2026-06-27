import type { GenerateRequest } from "./types";

/**
 * เลือกโมเดลตอบแชตตาม "เดิมพัน" ของคำถาม (router):
 * - เคสเสี่ยง/เดิมพันสูง (ตอบผิดแล้วเสียหาย ต้องระวังเป็นพิเศษ) → Opus 4.8 (ฉลาด/ระวังกว่า)
 * - คำถามทั่วไป/สินค้า-ราคา/แนะนำ → Sonnet 4.6 (ถูกกว่ามาก คุณภาพใกล้เคียงเมื่อมี retrieval ป้อนสเปกให้)
 * เป้าหมาย: ได้ความเก่ง Opus เฉพาะตอนจำเป็น + จ่ายถูกแบบ Sonnet เป็นส่วนใหญ่
 */

export const CHAT_OPUS = "claude-opus-4-8";
export const CHAT_SONNET = "claude-sonnet-4-6";

export type ModelTier = "opus" | "sonnet";
export type ModelChoice = { model: string; tier: ModelTier; reason: string };

// สัญญาณ "เคสยาก/เดิมพันสูง" → ใช้ Opus
const OPUS_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /ต่อราคา|ต่อรอง|ลดราคา|ลดได้|ลดหน่อย|ลดอีก|ถูกกว่านี้|แพงไป|ราคาพิเศษ|แถมได้/, reason: "ต่อรองราคา" },
  { re: /เคลม|claim|คืนเงิน|คืนของ|คืนสินค้า|เปลี่ยนของ|เปลี่ยนสินค้า|refund|รับประกัน.*(เคลม|เสีย)/i, reason: "เคลม/คืนเงิน" },
  { re: /ร้องเรียน|โกง|หลอก|ไม่พอใจ|แย่มาก|ห่วย|โมโห|โกรธ|ฟ้อง|ด่า/, reason: "ร้องเรียน/อารมณ์เสีย" },
  { re: /เสียแล้ว|พังแล้ว|ใช้ไม่ได้|ใช้ไม่ได้แล้ว|ชำรุด|มีปัญหา|ไม่ตรงปก|ส่งผิด|ได้ของผิด/, reason: "สินค้ามีปัญหา" },
  { re: /บวม|ระเบิด|ไฟไหม้|ไหม้|ควัน|อันตราย|ช็อต|ช็อค|ลัดวงจร|ร้อนผิดปกติ|ไฟรั่ว/, reason: "ความปลอดภัย" },
];

/** เลือกโมเดลจากคำขอแชต (pure function — เทสต์ได้) */
export function pickChatModel(req: GenerateRequest): ModelChoice {
  if ((req.imageUrls?.length ?? 0) > 0) {
    return { model: CHAT_OPUS, tier: "opus", reason: "มีรูป (วิเคราะห์/จับคู่คลังให้แม่น)" };
  }
  const text = req.customerMsg ?? "";
  for (const { re, reason } of OPUS_PATTERNS) {
    if (re.test(text)) return { model: CHAT_OPUS, tier: "opus", reason };
  }
  return { model: CHAT_SONNET, tier: "sonnet", reason: "คำถามทั่วไป/สินค้า-ราคา/แนะนำ" };
}
