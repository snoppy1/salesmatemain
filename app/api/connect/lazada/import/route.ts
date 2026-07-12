import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { fetchCatalog } from "@/lib/marketplace";
import { getMockSettings, isMockEnabled } from "@/lib/shopRepo";
import { compressDescriptions, compressNames } from "@/lib/descCompress";

export const runtime = "nodejs";
export const maxDuration = 60; // ย่อคำอธิบายหลายตัวด้วย AI อาจใช้เวลาหลายวินาที

// ดึงแคตตาล็อกสินค้าจาก Lazada → คืนเป็นรายการสินค้า (ฝั่ง client เอาไปเพิ่มในคลัง)
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  const token = await getValidAccessToken(admin.shopId, "lazada");
  if (!token) {
    return NextResponse.json({ error: "ยังไม่ได้เชื่อมต่อ Lazada" }, { status: 400 });
  }

  // ปิดข้อมูลทดลองสินค้าของเจ้านี้ + ยังเป็นการเชื่อมแบบ mock → ไม่ดึงสินค้าตัวอย่าง
  const mock = await getMockSettings(admin.shopId);
  if (token.startsWith("mock-") && !isMockEnabled(mock, "lazada", "catalog")) {
    return NextResponse.json({ products: [] });
  }

  let items;
  try {
    items = await fetchCatalog(token);
  } catch {
    return NextResponse.json({ error: "ดึงข้อมูลสินค้าไม่สำเร็จ" }, { status: 502 });
  }

  const named = items.filter((it) => it.name.trim());
  // ย่อคำอธิบาย + ล้างชื่อสำหรับ AI ตอนดึงเข้า (ลด token ตอนตอบ) — best-effort ไม่ทำให้ import พัง
  const [shortDescs, aiNames] = await Promise.all([
    compressDescriptions(named.map((it) => it.description), admin.shopId),
    compressNames(named.map((it) => it.name), admin.shopId),
  ]);
  const products = named.map((it, idx) => ({
    name: it.name,
    aiName: aiNames[idx] || undefined,
    price: it.price,
    description: shortDescs[idx],
    image: it.image,
    source: "lazada",
    externalId: it.externalId,
    stock: it.stock,
  }));

  return NextResponse.json({ products });
}
