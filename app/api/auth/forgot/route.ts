import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/auth";

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

  // TODO: ส่งอีเมลลิงก์รีเซ็ตจริง — รอตั้งค่า email provider (เช่น Resend)
  // ตอบกลางๆ เสมอ ไม่เปิดเผยว่ามีบัญชีนี้จริงไหม (กันการสุ่มเดาอีเมล)
  return NextResponse.json({ ok: true });
}
