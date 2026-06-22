import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { fetchPageInfo } from "@/lib/facebookClient";
import { saveChannel } from "@/lib/facebookChannelRepo";

export const runtime = "nodejs";

// เชื่อมเพจ Facebook ของร้าน: รับ Page Access Token → ตรวจด้วย /me → บันทึก
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
    return NextResponse.json(
      { error: "กรุณาใส่ Page Access Token" },
      { status: 400 },
    );
  }

  const info = await fetchPageInfo(accessToken);
  if (!info) {
    return NextResponse.json(
      { error: "Token ใช้ไม่ได้ — ตรวจ Page Access Token อีกครั้ง" },
      { status: 400 },
    );
  }

  await saveChannel(admin.shopId, {
    pageId: info.pageId,
    accessToken,
    pageName: info.name,
  });

  return NextResponse.json({ ok: true, pageName: info.name, pageId: info.pageId });
}
