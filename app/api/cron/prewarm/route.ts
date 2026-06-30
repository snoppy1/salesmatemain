import { NextResponse } from "next/server";
import { listActiveShopIds, getShopData } from "@/lib/shopRepo";
import { prewarmShop } from "@/lib/claude";

export const runtime = "nodejs";

/**
 * อุ่นแคช Anthropic ของร้านที่ใช้งานจริง (Vercel Cron ทุก ~30-50 นาที กันแคช 1 ชม.หมดอายุ)
 * → ข้อความแรกของลูกค้าเป็น cache-read (ถูก ~฿0.5) แทน cache-write (แพง ~฿2)
 * ต้องมี Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // อุ่นเฉพาะร้านที่มีแชตใน 6 ชม.ล่าสุด (active) — ไม่เปลืองอุ่นร้านที่ไม่มีคนใช้
  const ids = await listActiveShopIds(Date.now() - 6 * 60 * 60 * 1000);
  let warmed = 0;
  for (const id of ids) {
    try {
      const d = await getShopData(id);
      const ok = await prewarmShop({
        shopName: d.shop.name,
        shopVoice: d.shop.voice,
        shopMemory: d.shop.memory,
        products: d.products,
        promotions: [],
        customerMsg: ".",
      });
      if (ok) warmed++;
    } catch {
      /* best-effort ต่อร้าน */
    }
  }
  return NextResponse.json({ warmed, total: ids.length });
}
