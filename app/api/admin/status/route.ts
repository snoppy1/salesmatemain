import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { listCronRuns } from "@/lib/cronRunsRepo";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export type LazadaTokenStatus = {
  shopName: string;
  accountName: string;
  expiresAt: number | null;
  updatedAt: number;
  hasRefresh: boolean;
};

/** ร้านที่ token มีปัญหา — โชว์เป็นแบนเนอร์เตือนหน้าแรกแอดมิน */
export type ShopProblem = {
  shopName: string;
  accountName: string;
  severity: "critical" | "warning"; // critical=หมดอายุแล้ว(แชตหยุด) / warning=ต่ออายุล้มเหลว(กำลังจะหมด)
  reason: string;
};

/** สถานะระบบสำหรับ superadmin: ประวัติรัน cron + สุขภาพ token Lazada ทุกร้าน */
export async function GET() {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }

  const [runs, channels] = await Promise.all([
    listCronRuns(30),
    query<{
      shop_id: string;
      shop_name: string;
      account_name: string;
      expires_at: string | null;
      updated_at: string;
      refresh_token: string;
    }>(
      `SELECT lc.shop_id, s.name AS shop_name, lc.account_name, lc.expires_at, lc.updated_at, lc.refresh_token
         FROM lazada_channels lc JOIN shops s ON s.id = lc.shop_id
        ORDER BY s.name`,
    ),
  ]);

  const now = Date.now();

  const lazada: LazadaTokenStatus[] = channels.map((c) => ({
    shopName: c.shop_name,
    accountName: c.account_name,
    expiresAt: c.expires_at === null ? null : Number(c.expires_at),
    updatedAt: Number(c.updated_at),
    hasRefresh: c.refresh_token !== "",
  }));

  // shop_id (ย่อ 8) ที่ต่ออายุล้มเหลวในรอบ prewarm ล่าสุด → รู้ว่ากำลังจะพังก่อนหมดอายุ
  const lastPrewarm = runs.find((r) => r.job === "prewarm");
  const failedPrefixes = new Set<string>();
  if (lastPrewarm) {
    try {
      const d = JSON.parse(lastPrewarm.detail) as { refreshErrors?: string[] };
      for (const e of d.refreshErrors ?? []) failedPrefixes.add(String(e).split(":")[0]);
    } catch {
      /* detail ไม่ใช่ JSON — ข้าม */
    }
  }

  // ร้านที่พัง: หมดอายุแล้ว (critical) หรือ ต่ออายุอัตโนมัติล้มเหลว (warning)
  const problems: ShopProblem[] = [];
  for (const c of channels) {
    const exp = c.expires_at === null ? null : Number(c.expires_at);
    const failing = failedPrefixes.has(c.shop_id.slice(0, 8));
    if (exp !== null && exp < now) {
      problems.push({
        shopName: c.shop_name,
        accountName: c.account_name,
        severity: "critical",
        reason: "การเชื่อมต่อ Lazada หลุด — แชตใหม่ไม่เข้าจนกว่าจะเชื่อมใหม่",
      });
    } else if (failing) {
      const leftH = exp ? Math.max(0, Math.round((exp - now) / 3600e3)) : null;
      problems.push({
        shopName: c.shop_name,
        accountName: c.account_name,
        severity: "warning",
        reason:
          "ต่ออายุ token อัตโนมัติล้มเหลว" +
          (leftH !== null ? ` — อีก ~${leftH} ชม. จะหมดอายุ ควรกดเชื่อมใหม่ก่อน` : " — ควรกดเชื่อมใหม่"),
      });
    }
  }

  return NextResponse.json({ runs, lazada, problems, now });
}
