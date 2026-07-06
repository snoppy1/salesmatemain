import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getChannelByShop } from "@/lib/lazadaChannelRepo";
import { isLazadaChatConfigured } from "@/lib/lazadaChatClient";
import type { LazadaChannelStatus } from "@/lib/types";

export const runtime = "nodejs";

function webhookUrlOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/lazada/webhook`;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const webhookUrl = webhookUrlOf(request);
  const configured = isLazadaChatConfigured();
  const channel = await getChannelByShop(admin.shopId);

  const now = Date.now();
  const exp = channel?.expires_at != null ? Number(channel.expires_at) : null;
  const updated = channel ? Number(channel.updated_at) : 0;
  const expired = exp !== null && exp < now;
  // "กำลังจะพัง": ยังไม่หมด แต่เข้าช่วงต่ออายุ (<20 ชม.) แล้วยังไม่ถูกต่ออายุนานเกิน 2 ชม.
  // = cron ต่ออายุอัตโนมัติล้มเหลว (updated_at ขยับเฉพาะตอนต่ออายุสำเร็จ) → เตือนก่อนหมดอายุ
  const atRisk =
    !expired &&
    exp !== null &&
    exp - now < 20 * 3600e3 &&
    now - updated > 2 * 3600e3;

  const status: LazadaChannelStatus = channel
    ? {
        connected: true,
        accountName: channel.account_name,
        accountId: channel.account_id,
        webhookUrl,
        configured,
        mock: channel.access_token.startsWith("mock-"),
        expired,
        atRisk,
      }
    : { connected: false, webhookUrl, configured };

  return NextResponse.json(status);
}
