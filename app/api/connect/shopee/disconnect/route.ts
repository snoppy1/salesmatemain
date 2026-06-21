import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { deleteConnection } from "@/lib/connectionRepo";

export const runtime = "nodejs";

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  await deleteConnection(admin.shopId, "shopee");
  return NextResponse.json({ ok: true });
}
