import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifySignature, fetchDisplayName } from "@/lib/lineClient";
import { ingestCustomerMessage } from "@/lib/inboxRepo";

export const runtime = "nodejs";

/**
 * หาว่า LINE webhook นี้เข้าร้านไหน
 * - ตอนนี้รองรับร้านเดียวผ่าน env LINE_SHOP_USERNAME (ภายหลังค่อยแยก channel ต่อร้าน)
 * - ถ้าไม่ตั้ง ใช้ร้านแรกสุดในระบบ
 */
async function resolveShopId(): Promise<string | null> {
  const username = process.env.LINE_SHOP_USERNAME;
  if (username) {
    const row = await queryOne<{ shop_id: string }>(
      "SELECT shop_id FROM admins WHERE username = $1 LIMIT 1",
      [username.toLowerCase()],
    );
    if (row) return row.shop_id;
  }
  const first = await queryOne<{ id: string }>(
    "SELECT id FROM shops ORDER BY created_at ASC LIMIT 1",
  );
  return first?.id ?? null;
}

type LineEvent = {
  type: string;
  message?: { type: string; text?: string };
  source?: { userId?: string };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");

  // กันคนปลอมยิง webhook
  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // body เพี้ยน — ตอบ 200 กัน retry
  }

  const shopId = await resolveShopId();
  const events = payload.events ?? [];

  // ตอบ 200 เร็วๆ ได้เลย แต่ที่นี่ปริมาณน้อย ประมวลผลก่อนตอบ
  if (shopId) {
    for (const ev of events) {
      if (ev.type !== "message" || ev.message?.type !== "text") continue;
      const userId = ev.source?.userId ?? "";
      const text = ev.message.text ?? "";
      if (!userId || !text.trim()) continue;
      const displayName = await fetchDisplayName(userId);
      await ingestCustomerMessage(shopId, {
        channel: "line",
        lineUserId: userId,
        displayName,
        text,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
