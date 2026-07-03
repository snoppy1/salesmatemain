import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { bangkokDayStartMs } from "@/lib/adminStats";

export const runtime = "nodejs";

const DAY = 86400e3;
const BKK = 7 * 3600e3;
const THAI_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export type OverviewDay = {
  label: string; // ชื่อวันย่อภาษาไทย
  isToday: boolean;
  custMsgs: number; // ข้อความลูกค้าในวันนั้น
  aiMsgs: number; // ข้อความที่ AI ตอบเอง (ฐานคิดโควตา subscription/วัน)
  upsellValue: number; // มูลค่าที่ AI เสนอพ่วง (บาท)
};

/** ภาพรวมร้าน: จำนวนรอตอบตอนนี้ + ซีรีส์รายวัน 7 วันล่าสุด (เวลาไทย) */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const shopId = admin.shopId;

  const todayStart = bangkokDayStartMs();
  const weekStart = todayStart - 6 * DAY;
  // ดัชนีวันแบบเวลาไทย: floor((ms + 7ชม.) / 1วัน)
  const dayIndexOf = (ms: number) => Math.floor((ms + BKK) / DAY);
  const todayIndex = dayIndexOf(todayStart);

  const [pendingRow, msgRows, aiRows, upsellRows] = await Promise.all([
    queryOne<{ n: number }>(
      "SELECT count(*)::int AS n FROM conversations WHERE shop_id = $1 AND pending_human = true",
      [shopId],
    ),
    query<{ d: number; n: number }>(
      `SELECT FLOOR((m.created_at + 25200000) / 86400000)::int AS d, count(*)::int AS n
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.shop_id = $1 AND m.sender = 'customer' AND m.created_at >= $2
        GROUP BY 1`,
      [shopId, weekStart],
    ),
    query<{ d: number; n: number }>(
      `SELECT FLOOR((m.created_at + 25200000) / 86400000)::int AS d, count(*)::int AS n
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.shop_id = $1 AND m.ai_generated = true AND m.created_at >= $2
        GROUP BY 1`,
      [shopId, weekStart],
    ),
    query<{ d: number; v: number }>(
      `SELECT FLOOR((created_at + 25200000) / 86400000)::int AS d,
              COALESCE(SUM(est_value), 0)::int AS v
         FROM upsell_events
        WHERE shop_id = $1 AND created_at >= $2
        GROUP BY 1`,
      [shopId, weekStart],
    ),
  ]);

  const msgsByDay = new Map(msgRows.map((r) => [Number(r.d), Number(r.n)]));
  const aiByDay = new Map(aiRows.map((r) => [Number(r.d), Number(r.n)]));
  const upsellByDay = new Map(upsellRows.map((r) => [Number(r.d), Number(r.v)]));

  const daily: OverviewDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * DAY;
    const idx = todayIndex - i;
    const weekday = new Date(dayStart + BKK).getUTCDay();
    daily.push({
      label: i === 0 ? "วันนี้" : THAI_DAYS[weekday],
      isToday: i === 0,
      custMsgs: msgsByDay.get(idx) ?? 0,
      aiMsgs: aiByDay.get(idx) ?? 0,
      upsellValue: upsellByDay.get(idx) ?? 0,
    });
  }

  return NextResponse.json({ pendingNow: Number(pendingRow?.n ?? 0), daily });
}
