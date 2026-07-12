import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSession,
  setSessionCookie,
  createAccount,
  findAdminByGoogle,
  linkGoogleId,
} from "@/lib/auth";
export const runtime = "nodejs";

function redirectUri(request: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${new URL(request.url).origin}/api/auth/google/callback`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const savedState = store.get("g_oauth_state")?.value;
  store.delete("g_oauth_state");

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${origin}/login?e=google_failed`);
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/login?e=google_unconfigured`);
  }

  try {
    // แลก code → access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(request),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error("token");
    const tok = (await tokenRes.json()) as { access_token?: string };
    if (!tok.access_token) throw new Error("no_token");

    // ดึงโปรไฟล์ (อีเมล + ชื่อ + sub)
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    if (!infoRes.ok) throw new Error("userinfo");
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
    };
    if (!info.sub || !info.email) throw new Error("no_email");

    const email = info.email.toLowerCase();
    const googleId = info.sub;

    let admin = await findAdminByGoogle(googleId, email);
    if (admin) {
      await linkGoogleId(admin.id, googleId);
    } else {
      // สมัครได้ทุกคน — สิทธิ์ "เปิดกล่องแชต" เช็คตอนเพิ่มแอปแทน
      const adminId = await createAccount({
        shopName: info.name ? `ร้านของ ${info.name}` : "ร้านของฉัน",
        username: email,
        email,
        googleId,
      });
      admin = { id: adminId };
    }

    const { token, expiresAt } = await createSession(admin.id);
    await setSessionCookie(token, expiresAt, true);
    return NextResponse.redirect(`${origin}/`);
  } catch {
    return NextResponse.redirect(`${origin}/login?e=google_failed`);
  }
}
