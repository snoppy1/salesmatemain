import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { fetchBotInfo } from "@/lib/lineClient";
import { saveChannel } from "@/lib/lineChannelRepo";

export const runtime = "nodejs";

// เชื่อม LINE OA ของร้าน: รับ secret+token → ตรวจ token จริงด้วย /v2/bot/info → บันทึก
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: { channelSecret?: string; accessToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const channelSecret = (body.channelSecret ?? "").trim();
  const accessToken = (body.accessToken ?? "").trim();
  if (!channelSecret || !accessToken) {
    return NextResponse.json(
      { error: "กรุณาใส่ Channel secret และ Channel access token" },
      { status: 400 },
    );
  }

  try {
    const info = await fetchBotInfo(accessToken);
    if (!info) {
      return NextResponse.json(
        { error: "Channel access token ใช้ไม่ได้ — เช็คว่าคัดลอกครบ ไม่หมดอายุ และเป็นของ OA นี้" },
        { status: 400 },
      );
    }

    await saveChannel(admin.shopId, {
      channelSecret,
      accessToken,
      botUserId: info.userId,
      botBasicId: info.basicId,
      displayName: info.displayName,
    });

    return NextResponse.json({
      ok: true,
      displayName: info.displayName,
      basicId: info.basicId,
    });
  } catch (e) {
    // ตอบเป็น JSON เสมอ (ไม่ให้ throw เป็น 500 ลอยๆ) → หน้าเว็บจะได้โชว์เหตุผลจริง
    const msg = e instanceof Error ? e.message : "ข้อผิดพลาดภายใน";
    return NextResponse.json(
      { error: `เชื่อม LINE ไม่สำเร็จ: ${msg}` },
      { status: 500 },
    );
  }
}
