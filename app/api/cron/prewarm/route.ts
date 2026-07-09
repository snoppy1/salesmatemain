import { NextResponse } from "next/server";
import { listActiveShopIds, getShopData } from "@/lib/shopRepo";
import { prewarmShop } from "@/lib/claude";
import { listAllChannels, updateChannelTokens } from "@/lib/lazadaChannelRepo";
import { refreshImToken } from "@/lib/lazadaChatClient";
import { pollAllLazada } from "@/lib/lazadaPoll";
import { recordCronRun } from "@/lib/cronRunsRepo";

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

  // อุ่นเฉพาะร้านที่ "กำลังคุยอยู่" (มีแชตใน 1 ชม.ล่าสุด) — พอเงียบก็หยุดอุ่น ปล่อยแคชหมดอายุ
  // เดิม 6 ชม. ทำให้อุ่นทิ้งเปล่าเยอะสำหรับร้าน traffic ต่ำ (อุ่น 24 ชม.แพงกว่าจ่าย cold-start นานๆ ที)
  const PREWARM_WINDOW_MS = Number(process.env.PREWARM_ACTIVE_WINDOW_MS ?? 60 * 60 * 1000);
  const ids = await listActiveShopIds(Date.now() - PREWARM_WINDOW_MS);
  let warmed = 0;
  for (const id of ids) {
    try {
      const d = await getShopData(id);
      const ok = await prewarmShop({
        shopId: id,
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

  // poll แชต Lazada ใหม่ผ่าน API — backstop กัน push หยุด (ดึงเข้าเองแม้ push พลาด)
  let polledMsgs = 0;
  try {
    polledMsgs = await pollAllLazada();
  } catch (e) {
    console.error("[cron/prewarm] lazada poll failed:", e instanceof Error ? e.message : e);
  }

  // บันทึกผลไว้ให้หน้า "สถานะระบบ" — ok=false เมื่อต่ออายุ token ล้มเหลว
  await recordCronRun("prewarm", refreshErrors.length === 0, {
    warmed,
    total: ids.length,
    refreshedTokens,
    refreshErrors,
    polledMsgs,
  });

  return NextResponse.json({
    warmed,
    total: ids.length,
    refreshedTokens,
    refreshErrors,
    polledMsgs,
  });
}
