import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { fetchAccountInfo } from "@/lib/shopeeChatClient";
import { saveChannel } from "@/lib/shopeeChannelRepo";

export const runtime = "nodejs";

// เชื่อมบัญชีแชต Shopee ของร้าน: รับ access token (+ shop_id ถ้ามี) → ตรวจ → บันทึก
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { accessToken?: string; shopId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const accessToken = (body.accessToken ?? "").trim();
  const shopId = (body.shopId ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "กรุณาใส่ Access Token" }, { status: 400 });
  }

  const info = await fetchAccountInfo(accessToken, shopId);
  if (!info) {
    return NextResponse.json(
      { error: "Token ใช้ไม่ได้ — ใส่ Shop ID คู่กับ Access Token จริง (โหมดทดลองใช้ mock- ได้เลย)" },
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
