import type { Product } from "./types";

/**
 * ดึงเฉพาะสินค้าที่เกี่ยวกับคำถามลูกค้า เพื่อส่ง "สเปกเต็ม" ให้ AI เท่าที่จำเป็น
 * (ลด token: ไม่ต้องส่งคำอธิบายครบทุกชิ้นทุกข้อความ) — แต่ AI ยังเห็น "รายชื่อทั้งหมด" เสมอ
 * จากดัชนีย่อ (ชื่อ+ราคา+สต็อก) จึงไม่มีวันลืมว่ามีของอะไร/เสนอพ่วงได้ครบ
 */

/** ร้านสินค้าน้อยกว่า/เท่านี้ → ส่งคลังเต็ม (ถูกอยู่แล้ว ไม่ต้องเสี่ยงดึงเฉพาะที่เกี่ยว) */
export const RETRIEVAL_MIN_PRODUCTS = 24;
/** จำนวนสินค้าที่ส่ง "สเปกเต็ม" ต่อ 1 ข้อความ (เผื่อกว้างกันพลาด) */
export const MAX_RELEVANT = 10;

// คำที่เจอบ่อยจนไม่ช่วยแยกสินค้า (ตัดทิ้งตอนจับคู่) — เฉพาะคำเชื่อม/คำลงท้าย/คำห่อบทสนทนา
// ไม่ใส่คำหมวดสินค้า (แบต/ถ่าน) เพราะปล่อยให้ระบบให้คะแนน+จัดอันดับคัดเอง
const STOPWORDS = new Set([
  "มี", "ไหม", "มั้ย", "ครับ", "ค่ะ", "คะ", "นะ", "จ้า", "ราคา", "เท่าไหร่", "เท่าไร", "เท่า",
  "อยาก", "ได้", "ใช้", "กับ", "นี้", "นั้น", "อัน", "ของ", "ที่", "เป็น", "และ", "หรือ",
  "แบบ", "ตัว", "จะ", "ให้", "มา", "ไป", "สำหรับ", "ก็", "แล้ว", "ด้วย", "อยู่", "คือ",
  "ขอ", "หน่อย", "เลย", "พอ", "ต้อง", "ควร", "ยัง", "ไม่", "ดี", "กว่า", "ต่าง", "ยังไง",
  "อะไร", "เอา", "ซื้อ", "ขาย", "สนใจ", "สอบถาม", "ถาม", "บอก", "รับ", "เพิ่ม", "กี่",
  "ลูกค้า", "แอดมิน", "ช่องทาง", "ประวัติ", "แชต", "ข้อความ", "ร้าน", "สินค้า", "รุ่น",
  "line", "facebook", "lazada", "shopee", "tiktok",
]);

/** คำเคมี/ศัพท์เทคนิคภาษาอังกฤษที่ "เป็นสัญญาณแรง" แม้ไม่มีตัวเลข */
const TECH_WORDS = [
  "lifepo4", "li-ion", "liion", "lithium", "ลิเธียม", "nmc", "lto", "bms",
  "active", "passive", "balance", "บาลานซ์", "mosfet",
];

/** ดึง "คำสัญญาณ" จากข้อความลูกค้า: strong = เลข/หน่วย/รุ่น/ศัพท์เทคนิค (แยกของได้ชัด), weak = คำทั่วไป */
export function extractSignals(text: string): { weak: Set<string>; strong: Set<string> } {
  const lower = text.toLowerCase();
  const strong = new Set<string>();

  // 1) เลข+หน่วย: 48v, 30a, 20ah, 6000mah, 2000w, 4s, 13s (เรียงหน่วยยาวก่อนสั้น กัน "20ah" โดน "a" คว้าไปก่อน)
  const unitRe = /(\d+(?:\.\d+)?)\s*(mah|wh|ah|va|kw|v|a|w|s)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = unitRe.exec(lower))) strong.add(`${m[1]}${m[2].toLowerCase()}`);

  // 2) เลขรุ่น/ขนาดถ่าน 4-5 หลัก: 18650, 21700, 32700, 6000
  const modelNumRe = /\d{4,5}/g;
  while ((m = modelNumRe.exec(lower))) strong.add(m[0]);

  // 3) โค้ด/รหัสรุ่นที่ผสมตัวอักษร+ตัวเลข: bms150-200, g62, n40, lii-d4xl
  const codeRe = /[a-z]+\d+[a-z0-9-]*|\d+[a-z]+[a-z0-9-]*/gi;
  while ((m = codeRe.exec(lower))) if (m[0].length >= 2) strong.add(m[0].toLowerCase());

  // 4) ศัพท์เทคนิค/เคมี
  for (const w of TECH_WORDS) if (lower.includes(w)) strong.add(w);

  // weak: คำ token ทั่วไป (ไทย/อังกฤษ) ความยาว >= 2 ที่ไม่ใช่ stopword และไม่ใช่ตัวเลขล้วน
  const weak = new Set<string>();
  for (const tok of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (tok.length >= 2 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok)) weak.add(tok);
  }
  return { weak, strong };
}

/**
 * เลือกสินค้าที่เกี่ยวกับข้อความลูกค้า (สำหรับส่งสเปกเต็ม)
 * - ร้านสินค้าน้อย → useRetrieval=false คืนทั้งหมด (ผู้เรียกส่งคลังเต็มเหมือนเดิม)
 * - ร้านสินค้าเยอะ → useRetrieval=true คืนเฉพาะที่ match (อาจ [] ถ้าเป็นทักทาย/ไม่เกี่ยวสินค้า)
 */
export function selectRelevantProducts(
  products: Product[],
  customerText: string,
): { relevant: Product[]; useRetrieval: boolean } {
  const enabled = products.filter((p) => p.enabled !== false && p.name.trim());
  if (enabled.length <= RETRIEVAL_MIN_PRODUCTS) {
    return { relevant: enabled, useRetrieval: false };
  }

  const { weak, strong } = extractSignals(customerText);
  const scored = enabled.map((p) => {
    const hay = `${p.name} ${p.description}`.toLowerCase();
    let score = 0;
    for (const s of strong) if (hay.includes(s)) score += 3;
    for (const w of weak) if (hay.includes(w)) score += 1;
    return { p, score };
  });

  const relevant = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT)
    .map((s) => s.p);

  return { relevant, useRetrieval: true };
}
