import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getAutoReply, setAutoReply } from "@/lib/shopRepo";

export const runtime = "nodejs";

// สวิตช์ระดับร้าน: ให้ AI ตอบเองอัตโนมัติ (ค่าเริ่มต้นของบทสนทนาใหม่)
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json({ autoReply: await getAutoReply(admin.shopId) });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { autoReply?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  await setAutoReply(admin.shopId, Boolean(body.autoReply));
  return NextResponse.json({ autoReply: Boolean(body.autoReply) });
}
