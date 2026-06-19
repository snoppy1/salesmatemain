import { NextResponse } from "next/server";
import {
  isSuperEnabled,
  checkSuperCredentials,
  createSuperSession,
  setSuperCookie,
} from "@/lib/superAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSuperEnabled()) {
    return NextResponse.json(
      { error: "ยังไม่ได้เปิดใช้งานโซนผู้ดูแลระบบ (ตั้ง PHUANG_ADMIN_USER/PASS ก่อน)" },
      { status: 503 },
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!checkSuperCredentials(username, password)) {
    return NextResponse.json(
      { error: "ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลไม่ถูกต้อง" },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await createSuperSession(username);
  await setSuperCookie(token, expiresAt);
  return NextResponse.json({ username });
}
