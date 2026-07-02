import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { isValidEmail } from "@/lib/auth";
import {
  listAllowedEmails,
  addAllowedEmail,
  removeAllowedEmail,
} from "@/lib/allowlistRepo";

export const runtime = "nodejs";

const UNAUTHORIZED = () =>
  NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });

export async function GET() {
  if (!(await getCurrentSuperadmin())) return UNAUTHORIZED();
  return NextResponse.json({ emails: await listAllowedEmails() });
}

export async function POST(request: Request) {
  if (!(await getCurrentSuperadmin())) return UNAUTHORIZED();
  let body: { email?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  }
  await addAllowedEmail(email, (body.note ?? "").toString());
  return NextResponse.json({ emails: await listAllowedEmails() });
}

export async function DELETE(request: Request) {
  if (!(await getCurrentSuperadmin())) return UNAUTHORIZED();
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "ระบุอีเมลที่จะลบ" }, { status: 400 });
  }
  await removeAllowedEmail(email);
  return NextResponse.json({ emails: await listAllowedEmails() });
}
