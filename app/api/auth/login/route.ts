import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!username || !password) {
    return NextResponse.json(
      { error: "กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน" },
      { status: 400 },
    );
  }

  const admin = await queryOne<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM admins WHERE username = $1",
    [username],
  );

  // ข้อความเดียวกันทั้งกรณีไม่มี user และรหัสผิด กันการเดา
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return NextResponse.json(
      { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await createSession(admin.id);
  await setSessionCookie(token, expiresAt);

  return NextResponse.json({ username });
}
