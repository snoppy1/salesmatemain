import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { getMockSettings } from "@/lib/shopRepo";
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
  // เปิดโหมดข้อมูลทดลอง (mock) อยู่ไหม — ถ้าเปิด ยอดขายโชว์ 0 (เดโม) แต่ยังนับการพ่วงปกติ
  const mock = await getMockSettings(admin.shopId);
  const mockOn = Object.values(mock).some((s) => s?.chat === true || s?.catalog === true);

  // เชื่อม Lazada จริงไหม — ถ้าไม่ (ไม่มี token / เป็น mock) ยอดขาย+พ่วงขายได้โชว์ 0 (ไม่ปลอม)
  const token = await getValidAccessToken(admin.shopId, "lazada");
  const hasRealLazada = !mockOn && !!token && !token.startsWith("mock");
  if (hasRealLazada) await attributeUpsells(admin.shopId, token!).catch(() => {});

  const since = monthStart(Date.now());
  const [sales, offered, sold] = await Promise.all([
    hasRealLazada
      ? salesSince(token!, since)
      : Promise.resolve({ orderCount: 0, totalRevenue: 0 }),
    upsellSummary(admin.shopId, since),
    soldSummary(admin.shopId, since),
  ]);
  return NextResponse.json({ sales, offered, sold });
}
