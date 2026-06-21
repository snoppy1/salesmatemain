import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getChannelByShop } from "@/lib/lineChannelRepo";
import type { LineChannelStatus } from "@/lib/types";

export const runtime = "nodejs";

function webhookUrlOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/line/webhook`;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const webhookUrl = webhookUrlOf(request);
  const channel = await getChannelByShop(admin.shopId);

  const status: LineChannelStatus = channel
    ? {
        connected: true,
        displayName: channel.display_name,
        basicId: channel.bot_basic_id,
        webhookUrl,
        mock: channel.access_token.startsWith("mock-"),
      }
    : { connected: false, webhookUrl };

  return NextResponse.json(status);
}
