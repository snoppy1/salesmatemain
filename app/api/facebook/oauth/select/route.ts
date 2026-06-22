import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth";
import { listPages, subscribePageToApp } from "@/lib/facebookClient";
import { saveChannel } from "@/lib/facebookChannelRepo";

export const runtime = "nodejs";

// เลือกเพจ (กรณีมีหลายเพจ) → subscribe + บันทึก แล้วเคลียร์ user token ชั่วคราว
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { pageId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const pageId = (body.pageId ?? "").trim();

  const jar = await cookies();
  const userToken = jar.get("fb_user_token")?.value;
  if (!userToken || !pageId) {
    return NextResponse.json(
      { error: "หมดเวลาเลือกเพจ ลองกดเชื่อม Facebook ใหม่" },
      { status: 400 },
    );
  }

  const pages = await listPages(userToken);
  const p = pages.find((x) => x.id === pageId);
  if (!p) {
    return NextResponse.json({ error: "ไม่พบเพจที่เลือก" }, { status: 404 });
  }

  await subscribePageToApp(p.id, p.accessToken);
  await saveChannel(admin.shopId, {
    pageId: p.id,
    accessToken: p.accessToken,
    pageName: p.name,
  });

  const res = NextResponse.json({ ok: true, pageName: p.name });
  res.cookies.delete("fb_user_token");
  return res;
}
