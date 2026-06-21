import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getSendTarget, addAdminMessage } from "@/lib/inboxRepo";
import { pushMessage } from "@/lib/lineClient";

export const runtime = "nodejs";

// แอดมินกดส่ง (manual) → ยิงเข้า LINE จริงผ่าน Push API (หรือข้ามถ้าเป็นลูกค้าจำลอง) + บันทึกข้อความ
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { conversationId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!body.conversationId || !text) {
    return NextResponse.json({ error: "ระบุบทสนทนาและข้อความ" }, { status: 400 });
  }

  const target = await getSendTarget(admin.shopId, body.conversationId);
  if (!target) {
    return NextResponse.json({ error: "ไม่พบบทสนทนา" }, { status: 404 });
  }

  // ส่งเข้า LINE จริง (mock จะ return true โดยไม่ยิงจริง)
  const ok = await pushMessage(target.lineUserId ?? "", text);
  if (!ok) {
    return NextResponse.json(
      { error: "ส่งเข้า LINE ไม่สำเร็จ (ตรวจ token/สิทธิ์)" },
      { status: 502 },
    );
  }

  const message = await addAdminMessage(admin.shopId, body.conversationId, text);
  return NextResponse.json({ ok: true, message });
}
