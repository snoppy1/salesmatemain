import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listConversations } from "@/lib/inboxRepo";

export const runtime = "nodejs";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const conversations = await listConversations(admin.shopId);
  return NextResponse.json({ conversations });
}
