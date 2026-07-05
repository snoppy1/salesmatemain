import { NextResponse } from "next/server";
import { listActiveShopIds, getShopData } from "@/lib/shopRepo";
import { prewarmShop } from "@/lib/claude";
import { listAllChannels, updateChannelTokens } from "@/lib/lazadaChannelRepo";
import { refreshImToken } from "@/lib/lazadaChatClient";

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

  // ต่ออายุ Lazada IM token ที่ใกล้หมด (<20 ชม. = รีเฟรชทุกๆ ~4 ชม.) — กัน connection ตาย
  // (เคยใช้ 12 ชม.แล้ว refresh token ตายก่อน — สงสัย refresh token อายุสั้น จึงหมุนถี่ขึ้น)
  // ล้มเหลวต้องรายงานออกมาเสมอ (เคยกลืนเงียบจน token ตายไป 37 ชม. ไม่มีใครรู้)
  let refreshedTokens = 0;
  const refreshErrors: string[] = [];
  for (const ch of await listAllChannels()) {
    const exp = ch.expires_at ? Number(ch.expires_at) : 0;
    const nearExpiry = !exp || exp - Date.now() < 20 * 60 * 60 * 1000;
    if (!nearExpiry || !ch.refresh_token) continue;
    try {
      const r = await refreshImToken(ch.refresh_token);
      if (r.ok) {
        await updateChannelTokens(ch.shop_id, r.accessToken, r.refreshToken, r.expiresAt);
        refreshedTokens++;
      } else {
        refreshErrors.push(`${ch.shop_id.slice(0, 8)}:${r.error ?? "unknown"}`);
      }
    } catch (e) {
      refreshErrors.push(`${ch.shop_id.slice(0, 8)}:${e instanceof Error ? e.message : "throw"}`);
    }
  }
  if (refreshErrors.length) {
    console.error("[cron/prewarm] lazada token refresh failed:", refreshErrors.join(", "));
  }

  return NextResponse.json({ warmed, total: ids.length, refreshedTokens, refreshErrors });
}
