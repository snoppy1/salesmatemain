/** จับคู่ "สินค้าที่ AI พ่วง" กับรายการสินค้าในออเดอร์ (ตรงแบบ contains สองทาง) — คืนราคาที่ขายได้ */
export function matchUpsellProduct(
  product: string,
  items: { name: string; price: number }[],
): { price: number } | null {
  const p = product.trim().toLowerCase();
  if (!p) return null;
  for (const it of items) {
    const n = it.name.trim().toLowerCase();
    if (n && (n.includes(p) || p.includes(n))) return { price: it.price };
  }
  return null;
}
