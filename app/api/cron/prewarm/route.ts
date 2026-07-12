import { NextResponse } from "next/server";
import { listWarmableShopIds, getShopData } from "@/lib/shopRepo";
import { prewarmShop } from "@/lib/claude";
import { listAllChannels, updateChannelTokens } from "@/lib/lazadaChannelRepo";
import { refreshImToken } from "@/lib/lazadaChatClient";
import { pollAllLazada } from "@/lib/lazadaPoll";
import { recordCronRun } from "@/lib/cronRunsRepo";
import { shopsWarmedSince, shopsCacheAliveSince } from "@/lib/aiUsageRepo";
import { CHAT_SONNET } from "@/lib/modelRouter";
import { listPromotions } from "@/lib/promotionsRepo";
import { validNowPromotions } from "@/lib/promotions";
import { shopsWithUnsoldLazadaUpsells } from "@/lib/upsellRepo";
import { attributeUpsells } from "@/lib/upsellAttribution";
import { getValidAccessToken } from "@/lib/connectionRepo";

export const runtime = "nodejs";
export const maxDuration = 60; // เผื่อ warm + refresh token + poll แชต Lazada

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

  // อุ่นแบบ adaptive ต่อร้าน (traffic แต่ละร้านไม่เท่ากัน):
  // - AI ตอบจริงใน 1 ชม.ล่าสุด และ traffic ถึงเกณฑ์ (ลูกค้าทัก ≥15 ข้อความ/24 ชม.)
  // - "อ่านต่ออายุเท่านั้น": อุ่นเฉพาะร้านที่แคช Sonnet ยังอุ่น (มีอ่าน/เขียนใน 55 นาที)
  //   แคชตายแล้วไม่จุดเอง (เคยจ่าย 2x จุดทิ้งบ่อย) — ให้ข้อความจริงถัดไปจุดแบบ 1h เอง
  // - กันยิงซ้ำ: ข้ามร้านที่เพิ่งอุ่นใน 10 นาที (เคยเจอ trigger ซ้อนยิง 4 ครั้ง/นาที)
  const PREWARM_WINDOW_MS = Number(process.env.PREWARM_ACTIVE_WINDOW_MS ?? 60 * 60 * 1000);
  const PREWARM_MIN_MSGS_24H = Number(process.env.PREWARM_MIN_MSGS_24H ?? 15);
  const CACHE_ALIVE_MS = 55 * 60 * 1000; // อายุแคช 1 ชม. เผื่อ 5 นาที
  const [warmableIds, recentlyWarmed, cacheAlive] = await Promise.all([
    listWarmableShopIds(Date.now() - PREWARM_WINDOW_MS, PREWARM_MIN_MSGS_24H),
    shopsWarmedSince(Date.now() - 10 * 60 * 1000),
    shopsCacheAliveSince(Date.now() - CACHE_ALIVE_MS, CHAT_SONNET),
  ]);
  const ids = warmableIds.filter((id) => !recentlyWarmed.has(id) && cacheAlive.has(id));
  let warmed = 0;
  for (const id of ids) {
    try {
      const d = await getShopData(id);
      // โปรโมชั่นต้องเหมือนตอนตอบจริงเป๊ะ (เดิมส่ง [] — วันแรกที่ร้านมีโปร การอุ่นทั้งหมดจะกลายเป็นขยะเงียบๆ)
      const promotions = validNowPromotions(await listPromotions(id), Date.now());
      const ok = await prewarmShop({
        shopId: id,
        shopName: d.shop.name,
        shopVoice: d.shop.voice,
        shopMemory: d.shop.memory,
        products: d.products,
        promotions,
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

  // poll แชต Lazada ใหม่ผ่าน API — backstop กัน push หยุด (ดึงเข้าเองแม้ push พลาด)
  let polledMsgs = 0;
  try {
    polledMsgs = await pollAllLazada();
  } catch (e) {
    console.error("[cron/prewarm] lazada poll failed:", e instanceof Error ? e.message : e);
  }

  // แมตช์พ่วงกับออเดอร์จริงอัตโนมัติ (เดิมรันเฉพาะตอนร้านเปิดหน้าวัดผล → ตัวเลข "ปิดได้จริง" ค้าง 0)
  let matchedUpsells = 0;
  try {
    for (const shopId of await shopsWithUnsoldLazadaUpsells(Date.now() - 7 * 86400e3)) {
      const token = await getValidAccessToken(shopId, "lazada");
      if (!token || token.startsWith("mock")) continue;
      matchedUpsells += await attributeUpsells(shopId, token).catch(() => 0);
    }
  } catch (e) {
    console.error("[cron/prewarm] upsell attribution failed:", e instanceof Error ? e.message : e);
  }

  // บันทึกผลไว้ให้หน้า "สถานะระบบ" — ok=false เมื่อต่ออายุ token ล้มเหลว
  await recordCronRun("prewarm", refreshErrors.length === 0, {
    warmed,
    total: ids.length,
    refreshedTokens,
    refreshErrors,
    polledMsgs,
    matchedUpsells,
  });

  return NextResponse.json({
    warmed,
    total: ids.length,
    refreshedTokens,
    refreshErrors,
    polledMsgs,
    matchedUpsells,
  });
}
