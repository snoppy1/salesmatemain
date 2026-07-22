import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/auth";
import { allowAttempt, recordAttempt, clientIp } from "@/lib/throttle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  }

  // กันสแปมยิงขอรีเซ็ต (เผื่อวันที่ต่อ email provider จริง) — ตอบ ok กลางๆ ไม่เผยว่าโดนจำกัด
  const ipKey = `forgot-ip:${clientIp(request)}`;
  if (!(await allowAttempt(ipKey, 10))) {
    return NextResponse.json({ ok: true });
  }
  await recordAttempt(ipKey, 15 * 60_000);

  // TODO: ส่งอีเมลลิงก์รีเซ็ตจริง — รอตั้งค่า email provider (เช่น Resend)
  // ตอบกลางๆ เสมอ ไม่เปิดเผยว่ามีบัญชีนี้จริงไหม (กันการสุ่มเดาอีเมล)
  return NextResponse.json({ ok: true });
}
