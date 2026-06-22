import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth";
import { listPages } from "@/lib/facebookClient";

export const runtime = "nodejs";

// คืนรายชื่อเพจที่ร้านดูแล (จาก user token ชั่วคราวใน cookie) — สำหรับเลือกตอนมีหลายเพจ
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ pages: [] });
  const jar = await cookies();
  const userToken = jar.get("fb_user_token")?.value;
  if (!userToken) return NextResponse.json({ pages: [] });
  try {
    const pages = await listPages(userToken);
    return NextResponse.json({
      pages: pages.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch {
    return NextResponse.json({ pages: [] });
  }
}
