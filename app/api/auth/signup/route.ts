import { NextResponse } from "next/server";
import {
  hashPassword,
  createSession,
  setSessionCookie,
  createAccount,
  identifierTaken,
  isValidEmail,
  validatePasswordStrength,
} from "@/lib/auth";
import { isEmailAllowed } from "@/lib/allowlistRepo";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { shopName?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const shopName = (body.shopName ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!shopName) {
    return NextResponse.json({ error: "กรุณาใส่ชื่อร้าน" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  }
  // นโยบายรหัสผ่าน: ≥8 ตัว มีตัวอักษร+ตัวเลข+อักขระพิเศษ (ตามข้อกำหนดความปลอดภัยแพลตฟอร์ม)
  const pwError = validatePasswordStrength(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  if (await identifierTaken(email)) {
    return NextResponse.json(
      { error: "อีเมลนี้ถูกใช้แล้ว ลองเข้าสู่ระบบแทน" },
      { status: 409 },
    );
  }

  // beta gate: เฉพาะอีเมลที่ได้รับอนุญาตเท่านั้นที่สมัครได้
  if (!(await isEmailAllowed(email))) {
    return NextResponse.json(
      { error: "อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน" },
      { status: 403 },
    );
  }

  const adminId = await createAccount({
    shopName,
    username: email, // ใช้อีเมลเป็นตัวระบุล็อกอิน
    email,
    passwordHash: hashPassword(password),
  });

  const { token, expiresAt } = await createSession(adminId);
  await setSessionCookie(token, expiresAt);

  return NextResponse.json({ email, shopName });
}
