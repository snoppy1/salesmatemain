import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { dailyUpsellByShop } from "@/lib/upsellRepo";
import { bangkokDayStartMs } from "@/lib/adminStats";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const DAY = 86400e3;

/** ยอดขายจากการพ่วงของ AI รายวัน แยกรายร้าน — สำหรับแท็บ "ยอดขาย AI" ในคอนโซลแอดมิน */
export async function GET(request: Request) {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }

  const daysRaw = Number(new URL(request.url).searchParams.get("days") ?? "7");
  const days = [7, 30].includes(daysRaw) ? daysRaw : 7;
  const sinceMs = bangkokDayStartMs() - (days - 1) * DAY;

  const [rows, shopRows] = await Promise.all([
    dailyUpsellByShop(sinceMs),
    query<{ id: string; name: string }>("SELECT id, name FROM shops"),
  ]);
  const shopName = new Map(shopRows.map((s) => [s.id, s.name]));

  const totals = { offered: 0, estValue: 0, sold: 0, soldValue: 0 };
  for (const r of rows) {
    totals.offered += r.offered;
    totals.estValue += r.estValue;
    totals.sold += r.sold;
    totals.soldValue += r.soldValue;
  }

  return NextResponse.json({
    days,
    rows: rows.map((r) => ({ ...r, shopName: shopName.get(r.shopId) ?? "(ไม่พบร้าน)" })),
    totals,
  });
}
