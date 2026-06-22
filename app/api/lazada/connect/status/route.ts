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

  const status: LazadaChannelStatus = channel
    ? {
        connected: true,
        accountName: channel.account_name,
        accountId: channel.account_id,
        webhookUrl,
        configured,
        mock: channel.access_token.startsWith("mock-"),
      }
    : { connected: false, webhookUrl, configured };

  return NextResponse.json(status);
}
