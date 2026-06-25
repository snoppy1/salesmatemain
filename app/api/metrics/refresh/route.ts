import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { attributeUpsells } from "@/lib/upsellAttribution";
import { salesSince } from "@/lib/lazadaOrders";
import { upsellSummary, soldSummary, monthStart } from "@/lib/upsellRepo";

export const runtime = "nodejs";

// รัน attribution (best-effort) แล้วคืนตัวเลขทั้งหมดของเดือนนี้
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const token = (await getValidAccessToken(admin.shopId, "lazada")) ?? "mock-lazada";
  await attributeUpsells(admin.shopId, token).catch(() => {});

  const since = monthStart(Date.now());
  const [sales, offered, sold] = await Promise.all([
    salesSince(token, since),
    upsellSummary(admin.shopId, since),
    soldSummary(admin.shopId, since),
  ]);
  return NextResponse.json({ sales, offered, sold });
}
