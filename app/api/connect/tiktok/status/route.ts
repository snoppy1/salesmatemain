import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getStatus } from "@/lib/connectionRepo";
import { isTiktokConfigured } from "@/lib/tiktok";

export const runtime = "nodejs";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const status = await getStatus(admin.shopId, "tiktok");
  return NextResponse.json({ ...status, configured: isTiktokConfigured() });
}
