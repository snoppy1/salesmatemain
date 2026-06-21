import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { exchangeCode } from "@/lib/shopee";
import { saveConnection } from "@/lib/connectionRepo";

export const runtime = "nodejs";

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// ปลายทาง OAuth: รับ code + shop_id → แลก token → บันทึก connection → กลับหน้าแอป
export async function GET(request: Request) {
  const origin = originOf(request);
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.redirect(new URL("/login", origin));

  const params = new URL(request.url).searchParams;
  const code = params.get("code") ?? "";
  const shopId = params.get("shop_id") ?? "";
  if (!code) {
    return NextResponse.redirect(new URL("/?connect=error", origin));
  }

  try {
    const tokens = await exchangeCode(code, shopId);
    await saveConnection(admin.shopId, "shopee", tokens);
    return NextResponse.redirect(new URL("/?connected=shopee", origin));
  } catch {
    return NextResponse.redirect(new URL("/?connect=error", origin));
  }
}
