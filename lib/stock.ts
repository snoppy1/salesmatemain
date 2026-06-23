/**
 * ฟังก์ชันสต็อกที่ใช้ร่วมกันทั้งฝั่ง client (Dashboard) และ server (sync engine)
 * — เป็น pure function ไม่ผูกกับ DB/เบราว์เซอร์
 */

/** แยก source (CSV) เป็นรายชื่อ platform เช่น "lazada,shopee" → ["lazada","shopee"] */
export function sourceList(source?: string): string[] {
  return (source ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * รวมสต็อกแยกรายแพลตฟอร์มเป็นเลขเดียว (ที่ใช้ตอบลูกค้า/AI)
 * - ทุกเจ้าเท่ากัน → ใช้เลขนั้น
 * - ไม่เท่ากัน → ใช้ค่ามากสุด (ของยังมี) ส่วนรายละเอียดโชว์ติดข้างไอคอนแต่ละเจ้า
 */
export function unifyStock(map?: Record<string, number>): number | undefined {
  if (!map) return undefined;
  const vals = Object.values(map).filter((v) => typeof v === "number");
  if (!vals.length) return undefined;
  return vals.every((v) => v === vals[0]) ? vals[0] : Math.max(...vals);
}
