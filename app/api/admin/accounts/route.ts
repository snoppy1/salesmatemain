import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { listAccounts } from "@/lib/accountsRepo";

export const runtime = "nodejs";

/** รายชื่อบัญชีที่ลงทะเบียนทั้งหมด + สถานะสิทธิ์กล่องแชต (superadmin เท่านั้น) */
export async function GET() {
  if (!(await getCurrentSuperadmin())) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }
  return NextResponse.json({ accounts: await listAccounts() });
}
