import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { upsellSummary, monthStart } from "@/lib/upsellRepo";

export const runtime = "nodejs";

// สรุปยอดพ่วงที่ AI เสนอ (และส่งแล้ว) เดือนนี้
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const summary = await upsellSummary(admin.shopId, monthStart(Date.now()));
  return NextResponse.json(summary);
}
