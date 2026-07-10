import type { Product } from "./types";
import { extractSignals } from "./catalogRetrieval";

/**
 * เลือกสินค้า Lazada ที่ AI "เอ่ยถึงจริง" ในข้อความตอบ เพื่อส่งการ์ดสินค้าตามหลัง
 * (feedback ลูกค้า: AI แนะนำสินค้าแต่ไม่ส่งการ์ด ลูกค้าหาสินค้าไม่เจอ)
 *
 * หลักการ: เดาน้อยไว้ก่อน — ส่งการ์ดเฉพาะที่มั่นใจว่าถูกเอ่ยถึง คะแนนไม่ถึงเกณฑ์ = ไม่ส่งเลย
 * (การ์ดผิดตัวแย่กว่าไม่ส่ง) และห้ามส่งการ์ดของหมดเด็ดขาด
 */

/** คำที่โผล่ในสินค้าหลายตัวจนชี้ตัวไม่ได้ (เคมีแบต/ขนาดถ่านยอดฮิต/ศัพท์ทั่วไป) — ไม่ให้คะแนน */
const GENERIC_TOKENS = new Set([
  "lifepo4", "li-ion", "liion", "lithium", "nmc", "lto", "bms",
  "active", "passive", "balance", "mosfet",
  "18650", "21700", "26650", "32700", "32140",
]);

/** โค้ดรุ่นแบบตัวอักษร+ตัวเลขยาวพอ (เช่น lii-s12, b6ac, 48v20ah) — ชี้ตัวสินค้าได้แม่น */
function modelCodeTokens(nameLower: string): string[] {
  const out: string[] = [];
  for (const raw of nameLower.split(/\s+/)) {
    const t = raw.replace(/[^\p{L}\p{N}-]/gu, "");
    if (t.length >= 4 && /[a-z]/.test(t) && /\d/.test(t) && !GENERIC_TOKENS.has(t)) out.push(t);
  }
  return out;
}

export function pickMentionedLazadaProducts(
  replyText: string,
  upsellProduct: string,
  products: Product[],
  max = 2,
): Product[] {
  const reply = replyText.toLowerCase();
  const replyNoSpace = reply.replace(/\s+/g, ""); // "48V 20Ah" ในคำตอบ ให้จับกับ "48v20ah" ในชื่อได้
  const upsell = upsellProduct.trim().toLowerCase();
  if (!reply.trim()) return [];

  const candidates = products.filter(
    (p) =>
      p.enabled !== false &&
      p.name.trim() &&
      (p.externalId ?? "").trim() &&
      (p.source ?? "").includes("lazada") &&
      !(typeof p.stock === "number" && p.stock <= 0), // ของหมดห้ามส่งการ์ด
  );

  const scored = candidates.map((p, i) => {
    const nameLower = p.name.toLowerCase();
    let score = 0;
    for (const code of modelCodeTokens(nameLower)) {
      if (replyNoSpace.includes(code)) score += 2;
    }
    for (const s of extractSignals(nameLower).strong) {
      if (!GENERIC_TOKENS.has(s) && reply.includes(s)) score += 1;
    }
    // AI ระบุชื่อของที่พ่วงมาใน upsell_product — เทียบกับชื่อสินค้าตรงๆ
    if (upsell && (nameLower.includes(upsell) || (upsell.length >= 10 && upsell.includes(nameLower.slice(0, 25))))) {
      score += 3;
    }
    return { p, score, i };
  });

  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map((s) => s.p);
}
