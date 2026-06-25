import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth";
import {
  exchangeCodeForUserToken,
  listPages,
  subscribePageToApp,
} from "@/lib/facebookClient";
import { saveChannel } from "@/lib/facebookChannelRepo";

export const runtime = "nodejs";

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const cookieOpts = (origin: string) =>
  ({
    httpOnly: true,
    secure: !origin.startsWith("http://localhost"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  });

// ปลายทาง OAuth: รับ code → user token → ดูเพจ → ถ้าเพจเดียว save+subscribe เลย, หลายเพจให้ไปเลือก
export async function GET(request: Request) {
  const origin = originOf(request);
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.redirect(new URL("/login", origin));

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const jar = await cookies();
  const savedState = jar.get("fb_oauth_state")?.value;
  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(new URL("/?fb=error_state", origin));
  }

  try {
    const redirectUri = `${origin}/api/facebook/oauth/callback`;
    const userToken = await exchangeCodeForUserToken(code, redirectUri);
    const pages = await listPages(userToken);

    if (pages.length === 0) {
      return NextResponse.redirect(new URL("/?fb=nopage", origin));
    }

    if (pages.length === 1) {
      const p = pages[0];
      await subscribePageToApp(p.id, p.accessToken);
      await saveChannel(admin.shopId, {
        pageId: p.id,
        accessToken: p.accessToken,
        pageName: p.name,
      });
      const res = NextResponse.redirect(new URL("/?fb=connected", origin));
      res.cookies.delete("fb_oauth_state");
      return res;
    }

    // หลายเพจ → เก็บ user token ชั่วคราว แล้วให้ไปเลือกเพจในแอป
    const res = NextResponse.redirect(new URL("/?fb=choose", origin));
    res.cookies.set("fb_user_token", userToken, cookieOpts(origin));
    res.cookies.delete("fb_oauth_state");
    return res;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "เชื่อมต่อ Facebook ผิดพลาด";
    return NextResponse.redirect(
      new URL(`/?fb=error&reason=${encodeURIComponent(reason)}`, origin),
    );
  }
}
