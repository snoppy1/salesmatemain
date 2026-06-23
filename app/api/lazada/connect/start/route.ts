import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { buildImAuthUrl } from "@/lib/lazadaChatClient";

export const runtime = "nodejs";

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// เริ่ม OAuth ของแอปแชต Lazada (IM): เด้งไปหน้า authorize ของ Lazada
export async function GET(request: Request) {
  const origin = originOf(request);
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.redirect(new URL("/login", origin));
  return NextResponse.redirect(buildImAuthUrl(origin));
}
