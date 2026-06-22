import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อมแชต Lazada (IM) — รับ/ส่งข้อความ
 * - access token ขึ้นต้น mock- (หรือว่าง) → โหมดทดลอง ไม่ยิง API จริง
 * - LAZADA_CHAT_SECRET เป็นระดับแอป (env) ใช้ verify ลายเซ็น webhook (push notification)
 *
 * หมายเหตุ: Lazada ใช้ access token ตัวเดียวกับฝั่งดึงสินค้า (OAuth เดียวกัน)
 * แต่แยกแชตเป็นช่องของตัวเอง เพื่อให้โครงสร้างสม่ำเสมอกับ LINE/Facebook/TikTok
 * โค้ดส่วน "จริง" เป็น best-effort ตามรูปแบบ Lazada Open Platform — พอได้สิทธิ์ IM จริงค่อยปรับ endpoint
 */

const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";

function isMock(token: string): boolean {
  return !token || token.startsWith("mock-");
}

/** ตั้ง secret ระดับแอปสำหรับ verify webhook แล้วหรือยัง */
export function isLazadaChatConfigured(): boolean {
  return Boolean(process.env.LAZADA_CHAT_SECRET);
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

/* ---------- signing (Lazada ใช้ HMAC-SHA256 ของ path + params เรียงคีย์) ---------- */

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const base = path + sorted.map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

async function signedCall(
  path: string,
  accessToken: string,
  extra: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<Record<string, unknown>> {
  const appKey = process.env.LAZADA_APP_KEY as string;
  const appSecret = process.env.LAZADA_APP_SECRET as string;
  const params: Record<string, string> = {
    app_key: appKey,
    access_token: accessToken,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    ...extra,
  };
  params.sign = sign(path, params, appSecret);
  const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`, {
    method,
  });
  return (await res.json()) as Record<string, unknown>;
}

/** ส่งข้อความหาลูกค้า — true ถ้าสำเร็จ (หรือโหมดทดลอง) */
export async function sendMessage(
  accessToken: string,
  sessionId: string,
  text: string,
): Promise<boolean> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) return true;
  try {
    const data = await signedCall(
      "/im/message/send",
      accessToken,
      { session_id: sessionId, text },
      "POST",
    );
    return Number(data.code ?? 0) === 0 || data.code === "0";
  } catch {
    return false;
  }
}

export type LazadaAccount = { accountId: string; name: string };

/** ตรวจ token + ดึงข้อมูลร้าน/บัญชี Lazada — null ถ้า token ใช้ไม่ได้ */
export async function fetchAccountInfo(
  accessToken: string,
): Promise<LazadaAccount | null> {
  if (isMock(accessToken)) {
    const h = createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
    return { accountId: `mock-lzd-${h}`, name: "ร้าน Lazada ทดลอง (mock)" };
  }
  try {
    const data = await signedCall("/seller/get", accessToken, {});
    const seller = (data.data ?? {}) as Record<string, unknown>;
    const accountId = String(seller.seller_id ?? seller.short_code ?? "");
    if (!accountId) return null;
    return {
      accountId,
      name: String(seller.name ?? seller.shop_name ?? ""),
    };
  } catch {
    return null;
  }
}

/** ดึงชื่อลูกค้า — "" ถ้าไม่ได้/โหมดทดลอง (Lazada IM มักไม่ให้ชื่อจริง) */
export async function fetchUserName(
  accessToken: string,
  sessionId: string,
): Promise<string> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) return "";
  return "";
}
