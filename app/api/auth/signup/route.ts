import { NextResponse } from "next/server";
import {
  hashPassword,
  createSession,
  setSessionCookie,
  createAccount,
  identifierTaken,
  isValidEmail,
} from "@/lib/auth";

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
  if (password.length < 6) {
    return NextResponse.json(
      { error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" },
      { status: 400 },
    );
  }

  if (await identifierTaken(email)) {
    return NextResponse.json(
      { error: "อีเมลนี้ถูกใช้แล้ว ลองเข้าสู่ระบบแทน" },
      { status: 409 },
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
