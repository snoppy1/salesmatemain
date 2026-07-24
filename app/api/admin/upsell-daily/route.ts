import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { dailyUpsellByShop, dailyCardSendsByShop, dailyAssistByShop } from "@/lib/upsellRepo";
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

  const [upsellRows, cardRows, assistRows, shopRows] = await Promise.all([
    dailyUpsellByShop(sinceMs),
    dailyCardSendsByShop(sinceMs),
    dailyAssistByShop(sinceMs),
    query<{ id: string; name: string }>("SELECT id, name FROM shops"),
  ]);
  const shopName = new Map(shopRows.map((s) => [s.id, s.name]));

  // รวมสามแหล่งเป็นแถวเดียวต่อ (วัน, ร้าน) — บางวันมีการ์ดแต่ไม่มีการเสนอพ่วง (การ์ดจากการเอ่ยถึงปกติ)
  type MergedRow = {
    day: string; shopId: string; offered: number; estValue: number; sold: number; soldValue: number;
    cards: number; assisted: number; assistedValue: number;
  };
  const merged = new Map<string, MergedRow>();
  const keyOf = (day: string, shopId: string) => `${day}|${shopId}`;
  const blank = (day: string, shopId: string): MergedRow => ({
    day, shopId, offered: 0, estValue: 0, sold: 0, soldValue: 0, cards: 0, assisted: 0, assistedValue: 0,
  });
  for (const r of upsellRows) {
    merged.set(keyOf(r.day, r.shopId), { ...blank(r.day, r.shopId), ...r });
  }
  for (const c of cardRows) {
    const k = keyOf(c.day, c.shopId);
    const cur = merged.get(k) ?? blank(c.day, c.shopId);
    cur.cards += c.cards;
    merged.set(k, cur);
  }
  for (const a of assistRows) {
    const k = keyOf(a.day, a.shopId);
    const cur = merged.get(k) ?? blank(a.day, a.shopId);
    cur.assisted += a.assisted;
    cur.assistedValue += a.assistedValue;
    merged.set(k, cur);
  }
  const rows = [...merged.values()].sort(
    (a, b) => (a.day === b.day ? b.soldValue - a.soldValue : b.day.localeCompare(a.day)),
  );

  const totals = { offered: 0, estValue: 0, sold: 0, soldValue: 0, cards: 0, assisted: 0, assistedValue: 0 };
  for (const r of rows) {
    totals.offered += r.offered;
    totals.estValue += r.estValue;
    totals.sold += r.sold;
    totals.soldValue += r.soldValue;
    totals.cards += r.cards;
    totals.assisted += r.assisted;
    totals.assistedValue += r.assistedValue;
  }

  return NextResponse.json({
    days,
    rows: rows.map((r) => ({ ...r, shopName: shopName.get(r.shopId) ?? "(ไม่พบร้าน)" })),
    totals,
  });
}
