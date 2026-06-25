import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { fetchPromotions } from "@/lib/lazadaPromotions";
import { replacePromotions, listPromotions } from "@/lib/promotionsRepo";

export const runtime = "nodejs";

// ดึงโปรโมชั่นล่าสุดจาก Lazada → เก็บลง DB → คืนรายการที่เก็บแล้ว
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  // ยังไม่เชื่อม Lazada → ใช้ token mock เพื่อเดโม (fetchPromotions จะคืน mock)
  const token = (await getValidAccessToken(admin.shopId, "lazada")) ?? "mock-lazada";
  const promos = await fetchPromotions(token);
  await replacePromotions(admin.shopId, promos);
  return NextResponse.json({
    synced: promos.length,
    promotions: await listPromotions(admin.shopId),
  });
}
