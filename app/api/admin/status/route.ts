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

/** สถานะระบบสำหรับ superadmin: ประวัติรัน cron + สุขภาพ token Lazada ทุกร้าน */
export async function GET() {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }

  const [runs, channels] = await Promise.all([
    listCronRuns(30),
    query<{
      shop_name: string;
      account_name: string;
      expires_at: string | null;
      updated_at: string;
      refresh_token: string;
    }>(
      `SELECT s.name AS shop_name, lc.account_name, lc.expires_at, lc.updated_at, lc.refresh_token
         FROM lazada_channels lc JOIN shops s ON s.id = lc.shop_id
        ORDER BY s.name`,
    ),
  ]);

  const lazada: LazadaTokenStatus[] = channels.map((c) => ({
    shopName: c.shop_name,
    accountName: c.account_name,
    expiresAt: c.expires_at === null ? null : Number(c.expires_at),
    updatedAt: Number(c.updated_at),
    hasRefresh: c.refresh_token !== "",
  }));

  return NextResponse.json({ runs, lazada, now: Date.now() });
}
