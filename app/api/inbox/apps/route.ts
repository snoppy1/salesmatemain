import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listInboxApps, addInboxApp, removeInboxApp } from "@/lib/inboxAppsRepo";

export const runtime = "nodejs";

const VALID_CHANNELS = ["line", "facebook", "tiktok", "lazada", "shopee"];

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  return NextResponse.json({ apps: await listInboxApps(admin.shopId) });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
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
