import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { modelUsageRowsSince } from "@/lib/aiUsageRepo";
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

  const [rows, shopRows] = await Promise.all([
    modelUsageRowsSince(sinceMs),
    query<{ id: string; name: string }>("SELECT id, name FROM shops"),
  ]);
  const shopName = new Map(shopRows.map((s) => [s.id, s.name]));

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
      totalCostThb: 0,
    };
    cur.replies += r.replies;
    cur.replyCostThb += r.replyCostThb;
    cur.imports += r.imports;
    cur.importCostThb += r.importCostThb;
    cur.prewarmCostThb += r.prewarmCostThb;
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
    totals: {
      replies: overall.reduce((a, x) => a + x.replies, 0),
      costThb: overall.reduce((a, x) => a + x.totalCostThb, 0),
    },
  });
}
