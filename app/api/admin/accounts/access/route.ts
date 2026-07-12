import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { addAllowedEmail, removeAllowedEmail, normalizeEmail } from "@/lib/allowlistRepo";

export const runtime = "nodejs";

/**
 * เปิด/ปิดสิทธิ์เปิดกล่องแชตของบัญชีหนึ่ง (superadmin เท่านั้น)
 * body: { email: string, allowed: boolean } → add/remove allowed_emails (normalize ก่อน)
 */
export async function POST(request: Request) {
  if (!(await getCurrentSuperadmin())) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }

  let body: { email?: string; allowed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  if (!email) {
    return NextResponse.json({ error: "ระบุอีเมล" }, { status: 400 });
  }
  if (typeof body.allowed !== "boolean") {
    return NextResponse.json({ error: "ระบุสถานะสิทธิ์ (allowed)" }, { status: 400 });
  }

  if (body.allowed) {
    await addAllowedEmail(email, "เปิดสิทธิ์จากหน้าบัญชีผู้ใช้");
  } else {
    await removeAllowedEmail(email);
  }
  return NextResponse.json({ email, allowed: body.allowed });
}
