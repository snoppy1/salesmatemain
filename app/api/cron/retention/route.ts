import { NextResponse } from "next/server";
import { purgeOldConversations, expireOldImages } from "@/lib/retention";

export const runtime = "nodejs";

// ลบของเก่า (Vercel Cron วันละครั้ง) — ต้องมี Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const purgedConversations = await purgeOldConversations();
  const expiredImages = await expireOldImages();
  return NextResponse.json({ purgedConversations, expiredImages });
}
