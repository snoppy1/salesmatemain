import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getSendTarget, addAdminMessage } from "@/lib/inboxRepo";
import { getChannelByShop } from "@/lib/lazadaChannelRepo";
import { sendMessage } from "@/lib/lazadaChatClient";

export const runtime = "nodejs";

// แอดมินกดส่ง (manual) → ยิงเข้า Lazada จริงผ่าน IM API (หรือข้ามถ้าจำลอง) + บันทึกข้อความ
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

  const channel = await getChannelByShop(admin.shopId);
  const sent = await sendMessage(
    channel?.access_token ?? "",
    target.sessionId ?? "", // ส่งด้วย IM session_id จริง (ไม่ใช่ buyer_id)
    text,
  );
  if (!sent.ok) {
    return NextResponse.json(
      { error: "ส่งเข้า Lazada ไม่สำเร็จ (ตรวจ token/สิทธิ์)" },
      { status: 502 },
    );
  }

  // เก็บ message_id เป็น ext_id → webhook echo ของข้อความนี้จะ dedup ไม่ซ้ำ
  const message = await addAdminMessage(
    admin.shopId,
    body.conversationId,
    text,
    sent.messageId || undefined,
  );
  return NextResponse.json({ ok: true, message });
}
