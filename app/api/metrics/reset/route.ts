import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { clearUpsells } from "@/lib/upsellRepo";

export const runtime = "nodejs";

// รีเซ็ตข้อมูลพ่วง (ใช้ตอนสลับจาก mock กลับเป็นของจริง → เริ่มนับใหม่จาก 0)
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  await clearUpsells(admin.shopId);
  return NextResponse.json({ ok: true });
}
