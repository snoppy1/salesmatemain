import { NextResponse, after } from "next/server";
import { getCurrentAdmin, newId } from "@/lib/auth";
import {
  ingestCustomerMessage,
  addMessage,
  getSendTarget,
  getConversationMode,
} from "@/lib/inboxRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

/**
 * แชทจำลอง: จำลองว่าลูกค้าทักเข้ามา (ใช้ทดสอบ flow โดยไม่ต้องมี LINE จริง)
 * - ถ้าส่ง conversationId มา → ต่อบทสนทนาเดิม
 * - ถ้าไม่ส่ง → สร้างลูกค้าจำลองใหม่ (lineUserId ขึ้นต้น mock- เพื่อไม่ยิง LINE จริงตอนส่งกลับ)
 * - ถ้าแชตเป็นโหมด auto → ทริกเกอร์ AI ตอบเองด้วย (เหมือน webhook จริง) เพื่อทดสอบได้
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: {
    text?: string;
    conversationId?: string;
    customerName?: string;
    channel?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "ใส่ข้อความลูกค้าก่อน" }, { status: 400 });
  }
  const channel = body.channel === "facebook" ? "facebook" : "line";

  let conversationId: string;

  if (body.conversationId) {
    // ต่อบทสนทนาเดิม (ตรวจว่าเป็นของร้านนี้ก่อน)
    const owns = await getSendTarget(admin.shopId, body.conversationId);
    if (!owns) {
      return NextResponse.json({ error: "ไม่พบบทสนทนา" }, { status: 404 });
    }
    await addMessage(body.conversationId, "customer", text);
    conversationId = body.conversationId;
  } else {
    // เริ่มลูกค้าจำลองใหม่
    const name = (body.customerName ?? "").trim() || "ลูกค้าทดลอง";
    const cid = await ingestCustomerMessage(admin.shopId, {
      channel,
      lineUserId: "mock-" + newId(),
      displayName: name,
      text,
    });
    if (!cid) {
      return NextResponse.json({ error: "เพิ่มข้อความไม่สำเร็จ" }, { status: 500 });
    }
    conversationId = cid;
  }

  // โหมด auto → ให้ AI ตอบเอง (หลังตอบ response เพื่อให้ข้อความลูกค้าขึ้นทันที)
  const mode = await getConversationMode(conversationId);
  if (mode === "auto") {
    const cid = conversationId;
    after(() => processAutoReply(admin.shopId, cid, ""));
  }

  return NextResponse.json({ conversationId });
}
