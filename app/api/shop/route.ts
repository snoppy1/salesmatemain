import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getShopData, saveShopData } from "@/lib/shopRepo";
import type { Product, ShopData } from "@/lib/types";

export const runtime = "nodejs";

// เพดานกันสแปม/ข้อมูลบวม — สินค้าทุกชิ้นถูกสร้างเป็นดัชนีในพรอมป์ AI
// ปล่อยไม่จำกัด = ทั้ง DB บวมและต้นทุน AI พุ่งได้จากบัญชีเดียว (ร้านจริงใหญ่สุดตอนนี้ ~470 ชิ้น)
const MAX_PRODUCTS = 1000;
const MAX_RULES = 200;
const MAX_NAME = 500;
const MAX_DESC = 5000;
const MAX_PRICE = 50;
const MAX_IMAGE_DATA_URL = 900_000; // data URL ~650KB — พอสำหรับรูปที่ย่อแล้ว กันคนยัดรูปดิบหลาย MB
const MAX_IMAGE_HTTP_URL = 2000;

/** เก็บรูปเฉพาะรูปจริง: data:image/... ขนาดไม่เกินเพดาน หรือลิงก์ http(s) — อย่างอื่นทิ้ง (กันยัด javascript:/ไฟล์แปลก) */
function sanitizeImage(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  if (v.startsWith("data:image/") && v.length <= MAX_IMAGE_DATA_URL) return v;
  if (/^https?:\/\//.test(v) && v.length <= MAX_IMAGE_HTTP_URL) return v;
  return undefined;
}

function sanitizeProduct(p: Product): Product {
  return {
    ...p,
    name: (p.name ?? "").slice(0, MAX_NAME),
    aiName: p.aiName ? p.aiName.slice(0, MAX_NAME) : p.aiName,
    description: (p.description ?? "").slice(0, MAX_DESC),
    price: (p.price ?? "").slice(0, MAX_PRICE),
    image: sanitizeImage(p.image),
  };
}

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json(await getShopData(admin.shopId));
}

export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: ShopData;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const products = Array.isArray(body?.products) ? body.products : [];
  if (products.length > MAX_PRODUCTS) {
    return NextResponse.json(
      { error: `จำนวนสินค้าเกินเพดาน ${MAX_PRODUCTS.toLocaleString()} รายการ — ติดต่อทีมงานถ้าร้านมีสินค้ามากกว่านี้จริง` },
      { status: 400 },
    );
  }
  const rules = Array.isArray(body?.rules) ? body.rules.slice(0, MAX_RULES) : [];

  const saved = await saveShopData(admin.shopId, {
    shop: {
      name: (body?.shop?.name ?? "").slice(0, 200),
      voice: (body?.shop?.voice ?? "").slice(0, 4000),
      memory: (body?.shop?.memory ?? "").slice(0, 8000),
      gender: body?.shop?.gender, // undefined → COALESCE คงค่าเดิม (ดู saveShopData)
    },
    rules,
    products: products.map(sanitizeProduct),
  });

  return NextResponse.json(saved);
}
