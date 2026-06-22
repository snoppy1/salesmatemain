import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken, getStatus } from "@/lib/connectionRepo";
import { fetchCatalog } from "@/lib/shopee";

export const runtime = "nodejs";

// ดึงแคตตาล็อกสินค้าจาก Shopee → คืนเป็นรายการสินค้า (ฝั่ง client เอาไปเพิ่มในคลัง)
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  const token = await getValidAccessToken(admin.shopId, "shopee");
  if (!token) {
    return NextResponse.json({ error: "ยังไม่ได้เชื่อมต่อ Shopee" }, { status: 400 });
  }
  const status = await getStatus(admin.shopId, "shopee"); // เอา shop_id ไปใช้ตอนดึงสินค้า

  let items;
  try {
    items = await fetchCatalog(token, status.sellerId ?? "");
  } catch {
    return NextResponse.json({ error: "ดึงข้อมูลสินค้าไม่สำเร็จ" }, { status: 502 });
  }

  const products = items
    .filter((it) => it.name.trim())
    .map((it) => ({
      name: it.name,
      price: it.price,
      description: it.description,
      image: it.image,
      source: "shopee",
      externalId: it.externalId,
    }));

  return NextResponse.json({ products });
}
