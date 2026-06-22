import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentAdmin } from "@/lib/auth";
import { buildLoginUrl, canOAuth } from "@/lib/facebookClient";

export const runtime = "nodejs";

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// เริ่ม "เชื่อม Facebook คลิกเดียว": เด้งไปหน้าล็อกอิน Facebook (เลือกเพจ + ให้สิทธิ์)
export async function GET(request: Request) {
  const origin = originOf(request);
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.redirect(new URL("/login", origin));
  if (!canOAuth()) return NextResponse.redirect(new URL("/?fb=noapp", origin));

  const state = randomBytes(12).toString("hex");
  const redirectUri = `${origin}/api/facebook/oauth/callback`;
  const res = NextResponse.redirect(buildLoginUrl(redirectUri, state));
  res.cookies.set("fb_oauth_state", state, {
    httpOnly: true,
    secure: !origin.startsWith("http://localhost"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
