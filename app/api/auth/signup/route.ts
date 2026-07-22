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
import { allowAttempt, recordAttempt, clientIp } from "@/lib/throttle";
export const runtime = "nodejs";

const SIGNUP_WINDOW_MS = 60 * 60_000; // 1 ชั่วโมง
const SIGNUP_IP_LIMIT = 5; // สร้างบัญชีได้ไม่เกิน 5 บัญชี/ชม./IP — กันบอทปั๊มบัญชี

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

  // นับเฉพาะบัญชีที่สร้างสำเร็จ — พิมพ์ฟอร์มผิดกี่รอบไม่โดนบล็อก
  const ipKey = `signup-ip:${clientIp(request)}`;
  if (!(await allowAttempt(ipKey, SIGNUP_IP_LIMIT))) {
    return NextResponse.json(
      { error: "สมัครถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429 },
    );
  }

  // สมัครได้ทุกคน (เปิดให้ดู/ลองระบบ) — สิทธิ์ที่ต้องขอคือ "เปิดกล่องแชต" เช็คตอนเพิ่มแอปแทน
  const adminId = await createAccount({
    shopName,
    username: email, // ใช้อีเมลเป็นตัวระบุล็อกอิน
    email,
    passwordHash: hashPassword(password),
  });

  await recordAttempt(ipKey, SIGNUP_WINDOW_MS);

  const { token, expiresAt } = await createSession(adminId);
  await setSessionCookie(token, expiresAt);

  return NextResponse.json({ email, shopName });
}
