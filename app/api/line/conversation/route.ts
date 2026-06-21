import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getConversation } from "@/lib/inboxRepo";

export const runtime = "nodejs";

// รายละเอียดบทสนทนา 1 อัน (ข้อความทั้งหมด) — /api/line/conversation?id=...
export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "ระบุบทสนทนา" }, { status: 400 });
  }
  const conversation = await getConversation(admin.shopId, id);
  if (!conversation) {
    return NextResponse.json({ error: "ไม่พบบทสนทนา" }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}
