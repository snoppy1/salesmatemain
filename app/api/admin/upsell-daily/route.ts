import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { dailyUpsellByShop, dailyCardSendsByShop } from "@/lib/upsellRepo";
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

  const [upsellRows, cardRows, shopRows] = await Promise.all([
    dailyUpsellByShop(sinceMs),
    dailyCardSendsByShop(sinceMs),
    query<{ id: string; name: string }>("SELECT id, name FROM shops"),
  ]);
  const shopName = new Map(shopRows.map((s) => [s.id, s.name]));

  // รวมสองแหล่งเป็นแถวเดียวต่อ (วัน, ร้าน) — บางวันมีการ์ดแต่ไม่มีการเสนอพ่วง (การ์ดจากการเอ่ยถึงปกติ)
  const merged = new Map<
    string,
    { day: string; shopId: string; offered: number; estValue: number; sold: number; soldValue: number; cards: number }
  >();
  const keyOf = (day: string, shopId: string) => `${day}|${shopId}`;
  for (const r of upsellRows) {
    merged.set(keyOf(r.day, r.shopId), { ...r, cards: 0 });
  }
  for (const c of cardRows) {
    const k = keyOf(c.day, c.shopId);
    const cur = merged.get(k) ?? {
      day: c.day, shopId: c.shopId, offered: 0, estValue: 0, sold: 0, soldValue: 0, cards: 0,
    };
    cur.cards += c.cards;
    merged.set(k, cur);
  }
  const rows = [...merged.values()].sort(
    (a, b) => (a.day === b.day ? b.soldValue - a.soldValue : b.day.localeCompare(a.day)),
  );

  const totals = { offered: 0, estValue: 0, sold: 0, soldValue: 0, cards: 0 };
  for (const r of rows) {
    totals.offered += r.offered;
    totals.estValue += r.estValue;
    totals.sold += r.sold;
    totals.soldValue += r.soldValue;
    totals.cards += r.cards;
  }

  return NextResponse.json({
    days,
    rows: rows.map((r) => ({ ...r, shopName: shopName.get(r.shopId) ?? "(ไม่พบร้าน)" })),
    totals,
  });
}
