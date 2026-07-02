import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { getAdminOverview } from "@/lib/adminStats";

export const runtime = "nodejs";

export async function GET() {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }
  return NextResponse.json(await getAdminOverview());
}
