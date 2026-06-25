import { NextResponse } from "next/server";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  findAdminForLogin,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { identifier?: string; email?: string; password?: string; remember?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  // รับได้ทั้ง identifier (อีเมล/username) — รองรับบัญชีเก่าที่ใช้ username
  const identifier = (body.identifier ?? body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const remember = body.remember !== false;

  if (!identifier || !password) {
    return NextResponse.json(
      { error: "กรุณาใส่อีเมลและรหัสผ่าน" },
      { status: 400 },
    );
  }

  const admin = await findAdminForLogin(identifier);
  // ข้อความเดียวกันทั้งกรณีไม่มีบัญชีและรหัสผิด กันการเดา
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return NextResponse.json(
      { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await createSession(admin.id);
  await setSessionCookie(token, expiresAt, remember);

  return NextResponse.json({ ok: true });
}
