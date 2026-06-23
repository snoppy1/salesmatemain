import "server-only";
import type { CatalogItem } from "./marketplace";

/**
 * จำลอง "ของค่อยๆ ขายออก" สำหรับโหมด mock — ลดสต็อกตามเวลา
 * เพื่อให้เห็นตัวเลขขยับเวลากดซิงค์ (ของจริงจะดึงเลขจริงจาก marketplace แทน)
 *
 * เป็น pure function ของ base + เวลา และลด "เท่ากันทุกชิ้น" ในการเรียกครั้งเดียวกัน
 * → สินค้าซ้ำข้ามเจ้าที่ base เท่ากัน ยังคงเท่ากันเสมอ (โชว์เลขเดียว),
 *   ที่ base ต่างกันก็ยังต่างกัน (โชว์รายเจ้า)
 */
export function withLiveStock(items: CatalogItem[]): CatalogItem[] {
  const drop = Math.floor(Date.now() / 30000) % 6; // เปลี่ยนทุก 30 วิ, ลด 0..5
  if (drop === 0) return items;
  return items.map((it) =>
    typeof it.stock === "number" ? { ...it, stock: Math.max(0, it.stock - drop) } : it,
  );
}
