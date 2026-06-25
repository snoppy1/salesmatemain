// คีย์เวิร์ดบ่งบอกว่าลูกค้าถามเรื่องออเดอร์/การจัดส่ง
const ORDER_KEYWORDS = [
  "ส่งถึงไหน", "ส่งยัง", "พัสดุ", "เลขพัสดุ", "tracking", "ออเดอร์", "order",
  "สถานะ", "ของยัง", "เมื่อไหร่จะถึง", "ถึงเมื่อไหร่", "จัดส่ง", "ขนส่ง", "เลขออเดอร์",
];

// เรื่องที่ต้องส่งให้คนตอบเสมอ (เคลม/ยกเลิก/คืนเงิน/ร้องเรียน)
const ESCALATE_KEYWORDS = [
  "ยกเลิก", "คืนเงิน", "คืนของ", "เคลม", "ชำรุด", "ของเสีย", "ของผิด", "ไม่ได้รับของ",
  "ร้องเรียน", "refund", "cancel", "claim", "เงินคืน", "ผิดรุ่น", "ส่งผิด",
];

function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

/** ข้อความนี้เกี่ยวกับออเดอร์/การจัดส่งไหม (ตัดสินใจว่าจะเปิด tool ค้นออเดอร์) */
export function isOrderTopic(text: string): boolean {
  return hasAny(text, ORDER_KEYWORDS);
}

/** ต้องส่งให้คนตอบไหม (เคลม/ยกเลิก/คืนเงิน ฯลฯ) — บังคับ escalate แม้ full auto */
export function needsHumanForOrderTopic(text: string): boolean {
  return hasAny(text, ESCALATE_KEYWORDS);
}

/** ดึงเลขออเดอร์/พัสดุจากข้อความ (กลุ่มตัวอักษร+ตัวเลขยาว >= 6) — null ถ้าไม่เจอ */
export function extractOrderId(text: string): string | null {
  const m = text.match(/[A-Za-z0-9]{6,}/);
  return m ? m[0] : null;
}
