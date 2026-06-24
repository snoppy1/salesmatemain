import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อม LINE Messaging API — รับ credential "ต่อร้าน" เป็นพารามิเตอร์
 * - ถ้า token/secret ขึ้นต้น mock- (หรือว่าง) → โหมดทดลอง ไม่ยิง LINE จริง
 * - ใช้ Push API ส่งกลับ (ไม่ใช้ Reply API เพราะ replyToken หมดอายุเร็ว)
 */

const API_BASE = "https://api.line.me";

function isMock(secretOrToken: string): boolean {
  return !secretOrToken || secretOrToken.startsWith("mock-");
}

/** มี credential LINE ใน env ไหม (ใช้เป็น fallback ร้านเดียวแบบเดิม) */
export function isLineConfigured(): boolean {
  return Boolean(
    process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN,
  );
}

/** verify ลายเซ็น X-Line-Signature (HMAC-SHA256 ของ raw body ด้วย channel secret ของร้านนั้น) */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!channelSecret || !signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** ส่งข้อความกลับหาลูกค้าผ่าน Push API — true ถ้าสำเร็จ (หรือโหมดทดลอง) */
export async function pushMessage(
  accessToken: string,
  lineUserId: string,
  text: string,
): Promise<boolean> {
  // โหมดทดลอง หรือลูกค้าจำลอง → ไม่ยิงจริง ถือว่าสำเร็จ
  if (isMock(accessToken) || !lineUserId || lineUserId.startsWith("mock-")) return true;

  const res = await fetch(`${API_BASE}/v2/bot/message/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
  });
  return res.ok;
}

/** ตอบกลับด้วย Reply API (ฟรี ไม่กิน quota) — ใช้ในโหมด auto ตอน webhook ยังมี replyToken */
export async function replyMessage(
  accessToken: string,
  replyToken: string,
  text: string,
): Promise<boolean> {
  if (isMock(accessToken) || !replyToken || replyToken.startsWith("mock-")) return true;

  const res = await fetch(`${API_BASE}/v2/bot/message/reply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  return res.ok;
}

export type BotInfo = { userId: string; basicId: string; displayName: string };

/** ตรวจ token + ดึงข้อมูลบอท (GET /v2/bot/info) — null ถ้า token ใช้ไม่ได้ */
export async function fetchBotInfo(accessToken: string): Promise<BotInfo | null> {
  // โหมดทดลอง: สร้าง botUserId คงที่จาก hash ของ token (เทสต์ flow ได้โดยไม่มี OA จริง)
  if (isMock(accessToken)) {
    const h = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
    return { userId: `mock-bot-${h}`, basicId: "@mock", displayName: "ร้านทดลอง (mock)" };
  }
  try {
    const res = await fetch(`${API_BASE}/v2/bot/info`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      userId?: string;
      basicId?: string;
      displayName?: string;
    };
    if (!d.userId) return null;
    return {
      userId: d.userId,
      basicId: d.basicId ?? "",
      displayName: d.displayName ?? "",
    };
  } catch {
    return null;
  }
}

/** ดึงไฟล์รูป/มีเดียจาก LINE ตาม messageId (ต้องใช้ access token ของ OA) */
export async function getMessageContent(
  accessToken: string,
  messageId: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`LINE content ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

/** ดึงชื่อโปรไฟล์ลูกค้า — "" ถ้าไม่ได้/โหมดทดลอง */
export async function fetchDisplayName(
  accessToken: string,
  lineUserId: string,
): Promise<string> {
  if (isMock(accessToken) || !lineUserId || lineUserId.startsWith("mock-")) return "";
  try {
    const res = await fetch(`${API_BASE}/v2/bot/profile/${lineUserId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { displayName?: string };
    return data.displayName ?? "";
  } catch {
    return "";
  }
}
