import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อม LINE Messaging API
 * - ถ้ายังไม่ตั้ง LINE_CHANNEL_ACCESS_TOKEN → โหมดทดลอง (ไม่ยิงเข้า LINE จริง)
 * - ใช้ Push API ในการส่งกลับ (ไม่ใช้ Reply API เพราะ replyToken หมดอายุเร็ว)
 */

const API_BASE = "https://api.line.me";

export function isLineConfigured(): boolean {
  return Boolean(
    process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN,
  );
}

/** verify ลายเซ็น X-Line-Signature (HMAC-SHA256 ของ raw body ด้วย channel secret) */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** ส่งข้อความกลับหาลูกค้าผ่าน Push API — คืน true ถ้าส่งสำเร็จ (หรือโหมดทดลอง) */
export async function pushMessage(
  lineUserId: string,
  text: string,
): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  // โหมดทดลอง หรือเป็นลูกค้าจำลอง → ไม่ยิงจริง ถือว่าสำเร็จ
  if (!token || !lineUserId || lineUserId.startsWith("mock-")) return true;

  const res = await fetch(`${API_BASE}/v2/bot/message/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text }],
    }),
  });
  return res.ok;
}

/** ดึงชื่อโปรไฟล์ลูกค้าจาก LINE — คืน "" ถ้าไม่ได้/โหมดทดลอง */
export async function fetchDisplayName(lineUserId: string): Promise<string> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineUserId || lineUserId.startsWith("mock-")) return "";
  try {
    const res = await fetch(`${API_BASE}/v2/bot/profile/${lineUserId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { displayName?: string };
    return data.displayName ?? "";
  } catch {
    return "";
  }
}
