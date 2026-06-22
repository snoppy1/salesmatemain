import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getChannelByShop } from "@/lib/facebookChannelRepo";
import { isFacebookConfigured } from "@/lib/facebookClient";
import type { FacebookChannelStatus } from "@/lib/types";

export const runtime = "nodejs";

function webhookUrlOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/facebook/webhook`;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const webhookUrl = webhookUrlOf(request);
  const verifyToken = process.env.FB_VERIFY_TOKEN ?? "";
  const configured = isFacebookConfigured();
  const channel = await getChannelByShop(admin.shopId);

  const status: FacebookChannelStatus = channel
    ? {
        connected: true,
        pageName: channel.page_name,
        pageId: channel.page_id,
        webhookUrl,
        verifyToken,
        configured,
        mock: channel.access_token.startsWith("mock-"),
      }
    : { connected: false, webhookUrl, verifyToken, configured };

  return NextResponse.json(status);
}
