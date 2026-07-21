/** จับคู่ "สินค้าที่ AI พ่วง" กับรายการสินค้าในออเดอร์ (ตรงแบบ contains สองทาง)
 *  คืนราคา + ชื่อรายการที่แมตช์ (ให้ผู้เรียกกันนับรายการเดิมซ้ำหลายเหตุการณ์ได้) */
export function matchUpsellProduct(
  product: string,
  items: { name: string; price: number }[],
): { price: number; name: string } | null {
  const p = product.trim().toLowerCase();
  if (!p) return null;
  for (const it of items) {
    const n = it.name.trim().toLowerCase();
    if (n && (n.includes(p) || p.includes(n))) return { price: it.price, name: it.name };
  }
  return null;
}
