import { NextResponse } from "next/server";
import { getCurrentAdmin, newId } from "@/lib/auth";
import {
  ingestCustomerMessage,
  addMessage,
  getSendTarget,
} from "@/lib/inboxRepo";

export const runtime = "nodejs";

/**
 * แชทจำลอง: จำลองว่าลูกค้าทักเข้ามา (ใช้ทดสอบ flow โดยไม่ต้องมี LINE จริง)
 * - ถ้าส่ง conversationId มา → ต่อบทสนทนาเดิม
 * - ถ้าไม่ส่ง → สร้างลูกค้าจำลองใหม่ (lineUserId ขึ้นต้น mock- เพื่อไม่ยิง LINE จริงตอนส่งกลับ)
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { text?: string; conversationId?: string; customerName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "ใส่ข้อความลูกค้าก่อน" }, { status: 400 });
  }

  // ต่อบทสนทนาเดิม (ตรวจว่าเป็นของร้านนี้ก่อน)
  if (body.conversationId) {
    const owns = await getSendTarget(admin.shopId, body.conversationId);
    if (!owns) {
      return NextResponse.json({ error: "ไม่พบบทสนทนา" }, { status: 404 });
    }
    const msg = await addMessage(body.conversationId, "customer", text);
    return NextResponse.json({ conversationId: body.conversationId, message: msg });
  }

  // เริ่มลูกค้าจำลองใหม่
  const name = (body.customerName ?? "").trim() || "ลูกค้าทดลอง";
  const conversationId = await ingestCustomerMessage(admin.shopId, {
    channel: "line",
    lineUserId: "mock-" + newId(),
    displayName: name,
    text,
  });
  return NextResponse.json({ conversationId });
}
