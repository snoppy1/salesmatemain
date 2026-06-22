import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อมแชต TikTok (IM) — รับ/ส่งข้อความ
 * - access token ขึ้นต้น mock- (หรือว่าง) → โหมดทดลอง ไม่ยิง API จริง
 * - TIKTOK_CHAT_SECRET เป็นระดับแอป (env) ใช้ verify ลายเซ็น webhook
 *
 * หมายเหตุ: API แชทของ TikTok Shop เปิดให้บุคคลที่ 3 จำกัด — โค้ดส่วน "จริง" เป็น best-effort
 * ตามรูปแบบ Partner API พอได้สิทธิ์จริงค่อยปรับ endpoint ให้ตรง (โหมด mock ใช้ได้เลย)
 */

const HOST = process.env.TIKTOK_API_BASE || "https://open-api.tiktokglobalshop.com";

function isMock(token: string): boolean {
  return !token || token.startsWith("mock-");
}

/** ตั้ง secret ระดับแอปสำหรับ verify webhook แล้วหรือยัง */
export function isTiktokChatConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CHAT_SECRET);
}

/** verify ลายเซ็น webhook (HMAC-SHA256 hex ของ raw body ด้วย secret ระดับแอป) */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature.replace(/^sha256=/, ""));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** ส่งข้อความหาลูกค้า — true ถ้าสำเร็จ (หรือโหมดทดลอง) */
export async function sendMessage(
  accessToken: string,
  userId: string,
  text: string,
): Promise<boolean> {
  if (isMock(accessToken) || !userId || userId.startsWith("mock-")) return true;
  const res = await fetch(`${HOST}/im/202309/messages/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tts-access-token": accessToken,
    },
    body: JSON.stringify({ to_user_id: userId, content: { type: "text", text } }),
  });
  return res.ok;
}

export type TiktokAccount = { accountId: string; name: string };

/** ตรวจ token + ดึงข้อมูลร้าน/บัญชี TikTok — null ถ้า token ใช้ไม่ได้ */
export async function fetchAccountInfo(
  accessToken: string,
): Promise<TiktokAccount | null> {
  if (isMock(accessToken)) {
    const h = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
    return { accountId: `mock-tt-${h}`, name: "ร้าน TikTok ทดลอง (mock)" };
  }
  try {
    const res = await fetch(`${HOST}/authorization/202309/shops`, {
      method: "GET",
      headers: { "x-tts-access-token": accessToken },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { shops?: Record<string, unknown>[] } };
    const shop = json.data?.shops?.[0];
    if (!shop) return null;
    return {
      accountId: String(shop.id ?? shop.cipher ?? ""),
      name: String(shop.name ?? ""),
    };
  } catch {
    return null;
  }
}

/** ดึงชื่อลูกค้า — "" ถ้าไม่ได้/โหมดทดลอง (TikTok IM มักไม่ให้ชื่อจริง) */
export async function fetchUserName(
  accessToken: string,
  userId: string,
): Promise<string> {
  if (isMock(accessToken) || !userId || userId.startsWith("mock-")) return "";
  return "";
}
