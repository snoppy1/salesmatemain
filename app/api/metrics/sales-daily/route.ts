import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { getMockSettings } from "@/lib/shopRepo";
import { salesDailySince } from "@/lib/lazadaOrders";
import { bangkokDayStartMs } from "@/lib/adminStats";

export const runtime = "nodejs";

const DAY = 86400e3;
const BKK = 7 * 3600e3;
const THAI_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export type SalesDay = { label: string; isToday: boolean; revenue: number };

/**
 * ยอดขายรายวัน 7 วันล่าสุด (เวลาไทย) จาก Lazada Orders API
 * แยกจาก /api/metrics/overview เพราะเรียก API ภายนอก — โหลดครั้งเดียวตอนเปิดหน้า
 * ไม่ควรอยู่ใน endpoint ที่รีเฟรชทุก 30 วิ
 */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  // โหมดข้อมูลทดลอง หรือไม่ได้เชื่อม Lazada จริง → ยอดขาย 0 (ไม่ปลอม)
  const mock = await getMockSettings(admin.shopId);
  const mockOn = Object.values(mock).some((s) => s?.chat === true || s?.catalog === true);
  const token = await getValidAccessToken(admin.shopId, "lazada");
  const hasRealLazada = !mockOn && !!token && !token.startsWith("mock");

  const todayStart = bangkokDayStartMs();
  const weekStart = todayStart - 6 * DAY;
  const dayIndexOf = (ms: number) => Math.floor((ms + BKK) / DAY);
  const todayIndex = dayIndexOf(todayStart);

  const byDay = hasRealLazada
    ? await salesDailySince(token!, weekStart).catch(() => new Map<number, number>())
    : new Map<number, number>();

  const daily: SalesDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * DAY;
    const idx = todayIndex - i;
    const weekday = new Date(dayStart + BKK).getUTCDay();
    daily.push({
      label: i === 0 ? "วันนี้" : THAI_DAYS[weekday],
      isToday: i === 0,
      revenue: byDay.get(idx) ?? 0,
    });
  }

  return NextResponse.json({ daily, hasRealLazada });
}
