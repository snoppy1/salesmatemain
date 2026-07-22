import { NextResponse } from "next/server";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  findAdminForLogin,
  isPasswordExpired,
} from "@/lib/auth";
import { allowAttempt, recordAttempt, clearThrottle, clientIp } from "@/lib/throttle";

export const runtime = "nodejs";

const WINDOW_MS = 15 * 60_000; // หน้าต่างนับ 15 นาที
const EMAIL_LIMIT = 5; // ผิดเกิน 5 ครั้งต่ออีเมล → พัก
const IP_LIMIT = 20; // กันกระจายเดาหลายอีเมลจากเครื่องเดียว

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

  // rate limit กัน brute force — เช็คก่อนตรวจรหัส (โดนบล็อกแล้วไม่เผยด้วยซ้ำว่ารหัสถูกไหม)
  const ip = clientIp(request);
  const emailKey = `login:${identifier}`;
  const ipKey = `login-ip:${ip}`;
  if (!(await allowAttempt(emailKey, EMAIL_LIMIT)) || !(await allowAttempt(ipKey, IP_LIMIT))) {
    return NextResponse.json(
      { error: "ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
      { status: 429 },
    );
  }

  const admin = await findAdminForLogin(identifier);
  // ข้อความเดียวกันทั้งกรณีไม่มีบัญชีและรหัสผิด กันการเดา
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    await recordAttempt(emailKey, WINDOW_MS);
    await recordAttempt(ipKey, WINDOW_MS);
    return NextResponse.json(
      { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
      { status: 401 },
    );
  }
  await clearThrottle(emailKey); // รหัสถูก = ไม่ใช่คนเดารหัส ล้างตัวนับของอีเมลนี้

  // รหัสผ่านอายุเกิน 90 วัน → ต้องเปลี่ยนก่อน (นโยบายความปลอดภัย)
  if (isPasswordExpired(admin.password_updated_at)) {
    return NextResponse.json(
      {
        error:
          "รหัสผ่านใช้มาเกิน 90 วันแล้ว ต้องตั้งใหม่ก่อนเข้าใช้ — ติดต่อทีมงานเพื่อรีเซ็ตรหัสผ่าน",
      },
      { status: 403 },
    );
  }

  const { token, expiresAt } = await createSession(admin.id);
  await setSessionCookie(token, expiresAt, remember);

  return NextResponse.json({ ok: true });
}
