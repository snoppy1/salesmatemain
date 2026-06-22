import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { deleteChannel } from "@/lib/shopeeChannelRepo";

export const runtime = "nodejs";

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  await deleteChannel(admin.shopId);
  return NextResponse.json({ ok: true });
}
