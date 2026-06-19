import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SHOP_COOKIE = "phuang_session";
const SUPER_COOKIE = "phuang_super";

/**
 * เช็กแค่ "มี cookie ไหม" ที่ชั้น proxy (edge — ต่อ DB ไม่ได้)
 * การตรวจ session จริงทำใน server component / API route อีกชั้น
 *
 * 2 โซนแยกขาดกัน:
 * - /admin/*  → ผู้ดูแลระบบ (cookie phuang_super)
 * - ที่เหลือ  → แอดมินร้าน (cookie phuang_session)
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasShop = Boolean(req.cookies.get(SHOP_COOKIE)?.value);
  const hasSuper = Boolean(req.cookies.get(SUPER_COOKIE)?.value);

  // ----- โซนผู้ดูแลระบบ -----
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const isSuperLogin = pathname === "/admin/login";
    if (!hasSuper && !isSuperLogin) return redirectTo(req, "/admin/login");
    if (hasSuper && isSuperLogin) return redirectTo(req, "/admin");
    return NextResponse.next();
  }

  // ----- โซนร้าน -----
  const isShopAuthPage = pathname === "/login" || pathname === "/signup";
  if (!hasShop && !isShopAuthPage) return redirectTo(req, "/login");
  if (hasShop && isShopAuthPage) return redirectTo(req, "/");
  return NextResponse.next();
}

function redirectTo(req: NextRequest, path: string) {
  const url = req.nextUrl.clone();
  url.pathname = path;
  return NextResponse.redirect(url);
}

export const config = {
  // เฉพาะหน้าแอป — เว้น API, ไฟล์ static, รูป
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
