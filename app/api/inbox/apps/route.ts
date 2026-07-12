import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listInboxApps, addInboxApp, removeInboxApp } from "@/lib/inboxAppsRepo";
import { isEmailAllowed } from "@/lib/allowlistRepo";
import type { Admin } from "@/lib/types";

export const runtime = "nodejs";

const VALID_CHANNELS = ["line", "facebook", "tiktok", "lazada", "shopee"];

/** สิทธิ์เปิดกล่องแชต (beta gate ย้ายจากตอนสมัคร) — เช็คจากอีเมลบัญชีใน allowlist */
async function chatAllowed(admin: Admin): Promise<boolean> {
  return isEmailAllowed(admin.email || admin.username);
}

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  return NextResponse.json({
    apps: await listInboxApps(admin.shopId),
    chatAllowed: await chatAllowed(admin),
  });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  if (!(await chatAllowed(admin))) {
    return NextResponse.json(
      { error: "บัญชีนี้ยังไม่ได้รับสิทธิ์เปิดใช้กล่องแชต กรุณาติดต่อทีมงานเพื่อขอเปิดสิทธิ์" },
      { status: 403 },
    );
  }
  let body: { channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  if (!body.channel || !VALID_CHANNELS.includes(body.channel)) {
    return NextResponse.json({ error: "แพลตฟอร์มไม่ถูกต้อง" }, { status: 400 });
  }
  await addInboxApp(admin.shopId, body.channel);
  return NextResponse.json({ apps: await listInboxApps(admin.shopId) });
}

export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const channel = new URL(request.url).searchParams.get("channel") ?? "";
  await removeInboxApp(admin.shopId, channel);
  return NextResponse.json({ apps: await listInboxApps(admin.shopId) });
}
