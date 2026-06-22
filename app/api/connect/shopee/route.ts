import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { buildAuthUrl } from "@/lib/shopee";
import { getMockSettings, isMockEnabled } from "@/lib/shopRepo";

export const runtime = "nodejs";

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// เริ่ม OAuth: เด้งไปหน้า authorize ของ Shopee (หรือ callback จำลองในโหมด mock)
// เปิดสวิตช์ "ข้อมูลทดลองสินค้า" ไว้ → เชื่อมแบบ mock, ปิด → เชื่อมจริง
export async function GET(request: Request) {
  const origin = originOf(request);
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.redirect(new URL("/login", origin));
  const mock = await getMockSettings(admin.shopId);
  return NextResponse.redirect(
    buildAuthUrl(origin, isMockEnabled(mock, "shopee", "catalog")),
  );
}
