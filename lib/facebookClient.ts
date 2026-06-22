import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อม Facebook Messenger (Send API + webhook)
 * - Page Access Token ขึ้นต้น mock- (หรือว่าง) → โหมดทดลอง ไม่ยิง Graph API จริง
 * - App Secret / Verify Token เป็นระดับแอป (env) ใช้ตอน verify webhook
 */

const GRAPH = "https://graph.facebook.com/v21.0";

function isMock(token: string): boolean {
  return !token || token.startsWith("mock-");
}

/** ตั้งค่า env ระดับแอปครบไหม (App Secret + Verify Token) — โหมด webhook จริง */
export function isFacebookConfigured(): boolean {
  return Boolean(process.env.FB_APP_SECRET && process.env.FB_VERIFY_TOKEN);
}

/** verify ลายเซ็น X-Hub-Signature-256 ("sha256="+hex ของ raw body ด้วย App Secret) */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  appSecret: string,
): boolean {
  if (!appSecret || !signature || !signature.startsWith("sha256=")) return false;
  const expected =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** ส่งข้อความหาลูกค้าผ่าน Send API — true ถ้าสำเร็จ (หรือโหมดทดลอง) */
export async function sendMessage(
  pageToken: string,
  psid: string,
  text: string,
): Promise<boolean> {
  // โหมดทดลอง หรือลูกค้าจำลอง → ไม่ยิงจริง ถือว่าสำเร็จ
  if (isMock(pageToken) || !psid || psid.startsWith("mock-")) return true;

  const res = await fetch(
    `${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      }),
    },
  );
  return res.ok;
}

export type PageInfo = { pageId: string; name: string };

/** ตรวจ token + ดึงข้อมูลเพจ (GET /me) — null ถ้า token ใช้ไม่ได้ */
export async function fetchPageInfo(pageToken: string): Promise<PageInfo | null> {
  // โหมดทดลอง: สร้าง pageId คงที่จาก hash ของ token (เทสต์ flow ได้โดยไม่มีเพจจริง)
  if (isMock(pageToken)) {
    const h = createHash("sha256").update(pageToken).digest("hex").slice(0, 16);
    return { pageId: `mock-page-${h}`, name: "เพจทดลอง (mock)" };
  }
  const res = await fetch(
    `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`,
  );
  const d = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    error?: { message?: string; type?: string };
  };
  // โยน error พร้อมข้อความจริงจาก Facebook เพื่อให้ผู้ใช้รู้สาเหตุ
  if (!res.ok || d.error) {
    throw new Error(d.error?.message || `เรียก Facebook ไม่สำเร็จ (HTTP ${res.status})`);
  }
  if (!d.id) throw new Error("token นี้ไม่ได้ผูกกับเพจ (อาจเป็น User token ไม่ใช่ Page token)");
  return { pageId: String(d.id), name: String(d.name ?? "") };
}

/** ดึงชื่อลูกค้าจาก PSID — "" ถ้าไม่ได้/โหมดทดลอง */
export async function fetchUserName(
  pageToken: string,
  psid: string,
): Promise<string> {
  if (isMock(pageToken) || !psid || psid.startsWith("mock-")) return "";
  try {
    const res = await fetch(
      `${GRAPH}/${psid}?fields=name&access_token=${encodeURIComponent(pageToken)}`,
    );
    if (!res.ok) return "";
    const d = (await res.json()) as { name?: string };
    return String(d.name ?? "");
  } catch {
    return "";
  }
}
