import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { fetchAccountInfo } from "@/lib/tiktokClient";
import { saveChannel } from "@/lib/tiktokChannelRepo";

export const runtime = "nodejs";

// เชื่อมบัญชีแชต TikTok ของร้าน: รับ access token → ตรวจด้วย shops API → บันทึก
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { accessToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const accessToken = (body.accessToken ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "กรุณาใส่ Access Token" }, { status: 400 });
  }

  const info = await fetchAccountInfo(accessToken);
  if (!info) {
    return NextResponse.json(
      { error: "Token ใช้ไม่ได้ — ตรวจ Access Token อีกครั้ง" },
      { status: 400 },
    );
  }

  await saveChannel(admin.shopId, {
    accountId: info.accountId,
    accessToken,
    accountName: info.name,
  });

  return NextResponse.json({ ok: true, accountName: info.name, accountId: info.accountId });
}
