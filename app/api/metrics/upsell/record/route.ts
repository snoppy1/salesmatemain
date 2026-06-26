import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getConversation } from "@/lib/inboxRepo";
import { recordUpsell } from "@/lib/upsellRepo";

export const runtime = "nodejs";

// บันทึก "AI เสนอพ่วง" ตอนแอดมินกดส่งร่างที่ AI ร่างไว้ (โหมดร่าง) — โหมดตอบเองบันทึกใน autoReply อยู่แล้ว
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { conversationId?: string; product?: string; estValue?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  if (!body.conversationId) {
    return NextResponse.json({ error: "ระบุบทสนทนา" }, { status: 400 });
  }
  const convo = await getConversation(admin.shopId, body.conversationId);
  if (!convo) {
    return NextResponse.json({ error: "ไม่พบบทสนทนา" }, { status: 404 });
  }
  const estValue =
    typeof body.estValue === "number" && Number.isFinite(body.estValue) ? body.estValue : null;
  await recordUpsell({
    shopId: admin.shopId,
    conversationId: body.conversationId,
    channel: convo.channel,
    product: (body.product ?? "").toString(),
    estValue,
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
