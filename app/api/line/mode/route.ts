import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { setMode } from "@/lib/inboxRepo";

export const runtime = "nodejs";

// override โหมดรายบทสนทนา (auto/manual)
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { conversationId?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const mode = body.mode === "auto" ? "auto" : "manual";
  if (!body.conversationId) {
    return NextResponse.json({ error: "ระบุบทสนทนา" }, { status: 400 });
  }
  await setMode(admin.shopId, body.conversationId, mode);
  return NextResponse.json({ ok: true, mode });
}
