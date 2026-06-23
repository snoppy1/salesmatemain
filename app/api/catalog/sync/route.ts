import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { syncAllPlatforms } from "@/lib/catalogSync";
import { getShopData } from "@/lib/shopRepo";

export const runtime = "nodejs";

// ซิงค์สินค้า+สต็อกล่าสุดจากทุก marketplace ที่เชื่อมไว้ แล้วคืนรายการสินค้าที่อัปเดตแล้ว
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const synced = await syncAllPlatforms(admin.shopId);
  const data = await getShopData(admin.shopId);
  return NextResponse.json({ synced, products: data.products });
}
