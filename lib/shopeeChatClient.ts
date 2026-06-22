import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อมแชต Shopee (Seller Chat / IM) — รับ/ส่งข้อความ
 * - access token ขึ้นต้น mock- (หรือว่าง) → โหมดทดลอง ไม่ยิง API จริง
 * - ใช้ SHOPEE_PARTNER_ID/KEY (ระดับแอป) เซ็นคำขอ + verify ลายเซ็น webhook (push)
 *
 * ต่างจาก Lazada ตรงที่ Shopee ต้องใช้ shop_id (= accountId) ทั้งตอนเซ็นและตอนส่งข้อความ
 * โค้ดส่วน "จริง" เป็น best-effort ตาม Shopee Open Platform v2 — พอได้สิทธิ์ Chat จริงค่อยปรับ
 */

const HOST = process.env.SHOPEE_API_BASE || "https://partner.shopeemobile.com";

function isMock(token: string): boolean {
  return !token || token.startsWith("mock-");
}

/** ตั้ง partner key ระดับแอปแล้วหรือยัง (ใช้เซ็น + verify webhook) */
export function isShopeeChatConfigured(): boolean {
  return Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
}

/* ---------- signing (เหมือน lib/shopee.ts: partner_id + path + ts [+ token + shop_id]) ---------- */

function signed(path: string, extra = ""): { ts: number; sign: string } {
  const partnerId = process.env.SHOPEE_PARTNER_ID as string;
  const key = process.env.SHOPEE_PARTNER_KEY as string;
  const ts = Math.floor(Date.now() / 1000);
  const base = `${partnerId}${path}${ts}${extra}`;
  const sign = createHmac("sha256", key).update(base).digest("hex");
  return { ts, sign };
}

/**
 * verify ลายเซ็น webhook ของ Shopee push:
 * Authorization = HMAC-SHA256(url + "|" + raw_body, partner_key) เป็น hex
 */
export function verifySignature(
  url: string,
  rawBody: string,
  signature: string | null,
): boolean {
  const key = process.env.SHOPEE_PARTNER_KEY;
  if (!key || !signature) return false;
  const expected = createHmac("sha256", key).update(`${url}|${rawBody}`).digest("hex");
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
  accountId: string, // shop_id
  toUserId: string,
  text: string,
): Promise<boolean> {
  if (isMock(accessToken) || !toUserId || toUserId.startsWith("mock-")) return true;
  try {
    const path = "/api/v2/sellerchat/send_message";
    const { ts, sign } = signed(path, `${accessToken}${accountId}`);
    const params = new URLSearchParams({
      partner_id: process.env.SHOPEE_PARTNER_ID as string,
      timestamp: String(ts),
      sign,
      access_token: accessToken,
      shop_id: accountId,
    });
    const res = await fetch(`${HOST}${path}?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to_id: Number(toUserId),
        message_type: "text",
        content: { text },
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return !data.error || data.error === "";
  } catch {
    return false;
  }
}

export type ShopeeAccount = { accountId: string; name: string };

/**
 * ตรวจ token + ดึงข้อมูลร้าน Shopee — null ถ้า token ใช้ไม่ได้
 * โหมดจริงต้องมี shopId (จาก OAuth) — โหมด mock อนุมานจาก hash ของ token
 */
export async function fetchAccountInfo(
  accessToken: string,
  shopId = "",
): Promise<ShopeeAccount | null> {
  if (isMock(accessToken)) {
    const h = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
    return { accountId: shopId || `mock-shp-${h}`, name: "ร้าน Shopee ทดลอง (mock)" };
  }
  if (!shopId) return null;
  try {
    const path = "/api/v2/shop/get_shop_info";
    const { ts, sign } = signed(path, `${accessToken}${shopId}`);
    const params = new URLSearchParams({
      partner_id: process.env.SHOPEE_PARTNER_ID as string,
      timestamp: String(ts),
      sign,
      access_token: accessToken,
      shop_id: shopId,
    });
    const res = await fetch(`${HOST}${path}?${params}`, { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return { accountId: shopId, name: String(data.shop_name ?? "") };
  } catch {
    return null;
  }
}

/** ดึงชื่อลูกค้า — "" ถ้าไม่ได้/โหมดทดลอง (มักได้ชื่อจาก payload webhook อยู่แล้ว) */
export async function fetchUserName(
  accessToken: string,
  userId: string,
): Promise<string> {
  if (isMock(accessToken) || !userId || userId.startsWith("mock-")) return "";
  return "";
}
