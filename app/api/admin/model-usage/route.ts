import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { modelUsageRowsSince, dailyCacheWriteRows } from "@/lib/aiUsageRepo";
import { cacheWriteCostThb } from "@/lib/aiPricing";
import { bangkokDayStartMs } from "@/lib/adminStats";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const DAY = 86400e3;

export type ModelAgg = {
  model: string;
  replies: number;
  replyCostThb: number;
  imports: number;
  importCostThb: number;
  prewarmCostThb: number;
  cacheWriteCostThb: number; // ค่าเขียนแคชใหม่ (ซ้อนอยู่ในต้นทุนตอบ+อุ่นแล้ว ไม่ใช่ยอดบวกเพิ่ม)
  coldWrites: number; // จุดแคชใหม่กี่ครั้ง
  totalCostThb: number;
};
export type ShopModelUsage = {
  shopId: string;
  shopName: string;
  replies: number;
  totalCostThb: number;
  models: ModelAgg[];
};

/** การใช้โมเดล AI ในคอนโซลแอดมิน: รวมทุกร้าน + แยกรายร้าน (คลิกดูร้านย่อย) */
export async function GET(request: Request) {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }

  // ช่วงเวลา: 1 = วันนี้, 7, 30 วัน (เวลาไทย)
  const daysRaw = Number(new URL(request.url).searchParams.get("days") ?? "7");
  const days = [1, 7, 30].includes(daysRaw) ? daysRaw : 7;
  const sinceMs = bangkokDayStartMs() - (days - 1) * DAY;

  const [rows, dailyRows, shopRows] = await Promise.all([
    modelUsageRowsSince(sinceMs),
    dailyCacheWriteRows(sinceMs),
    query<{ id: string; name: string }>("SELECT id, name FROM shops"),
  ]);
  const shopName = new Map(shopRows.map((s) => [s.id, s.name]));

  // จุดแคชรายวันต่อร้าน (รวมทุกโมเดล) — ตัวชี้สุขภาพแคช
  const dailyMap = new Map<
    string,
    { day: string; shopId: string; chatWrites: number; prewarmWrites: number; costThb: number }
  >();
  for (const r of dailyRows) {
    const key = `${r.day}|${r.shopId}`;
    const cur = dailyMap.get(key) ?? {
      day: r.day, shopId: r.shopId, chatWrites: 0, prewarmWrites: 0, costThb: 0,
    };
    cur.chatWrites += r.chatWrites;
    cur.prewarmWrites += r.prewarmWrites;
    // ทุกเส้นทางเขียนแบบ 1h แล้ว (แถวเก่ายุค 5m แสดงสูงเกินจริงเล็กน้อย ชั่วคราวจนพ้นหน้าต่าง 7 วัน)
    cur.costThb += cacheWriteCostThb(r.model, 0, r.w5mTokens + r.w1hTokens);
    dailyMap.set(key, cur);
  }
  const dailyWrites = [...dailyMap.values()]
    .filter((d) => d.chatWrites + d.prewarmWrites > 0)
    .sort((a, b) => (a.day === b.day ? b.costThb - a.costThb : b.day.localeCompare(a.day)))
    .map((d) => ({ ...d, shopName: shopName.get(d.shopId) ?? "(ไม่พบร้าน)" }));

  // รวมทุกร้าน แยกตามโมเดล
  const overallMap = new Map<string, ModelAgg>();
  const addTo = (map: Map<string, ModelAgg>, r: (typeof rows)[number]) => {
    const cur = map.get(r.model) ?? {
      model: r.model,
      replies: 0,
      replyCostThb: 0,
      imports: 0,
      importCostThb: 0,
      prewarmCostThb: 0,
      cacheWriteCostThb: 0,
      coldWrites: 0,
      totalCostThb: 0,
    };
    cur.replies += r.replies;
    cur.replyCostThb += r.replyCostThb;
    cur.imports += r.imports;
    cur.importCostThb += r.importCostThb;
    cur.prewarmCostThb += r.prewarmCostThb;
    cur.cacheWriteCostThb += r.cacheWriteCostThb;
    cur.coldWrites += r.coldWrites;
    cur.totalCostThb += r.totalCostThb;
    map.set(r.model, cur);
  };
  for (const r of rows) addTo(overallMap, r);

  // แยกรายร้าน
  const byShopMap = new Map<string, Map<string, ModelAgg>>();
  for (const r of rows) {
    if (!byShopMap.has(r.shopId)) byShopMap.set(r.shopId, new Map());
    addTo(byShopMap.get(r.shopId)!, r);
  }

  const sortModels = (a: ModelAgg[]) => a.sort((x, y) => y.totalCostThb - x.totalCostThb);

  const byShop: ShopModelUsage[] = [...byShopMap.entries()]
    .map(([shopId, m]) => {
      const models = sortModels([...m.values()]);
      return {
        shopId,
        shopName: shopName.get(shopId) ?? "(ไม่พบร้าน)",
        replies: models.reduce((a, x) => a + x.replies, 0),
        totalCostThb: models.reduce((a, x) => a + x.totalCostThb, 0),
        models,
      };
    })
    .sort((a, b) => b.totalCostThb - a.totalCostThb);

  const overall = sortModels([...overallMap.values()]);
  return NextResponse.json({
    days,
    overall,
    byShop,
    dailyWrites,
    totals: {
      replies: overall.reduce((a, x) => a + x.replies, 0),
      costThb: overall.reduce((a, x) => a + x.totalCostThb, 0),
    },
  });
}
