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

  const appId = process.env.FB_APP_ID ?? "";
  const appSecret = process.env.FB_APP_SECRET ?? "";

  // วิธีหลัก: debug_token (ใช้ app token = app_id|app_secret) — ได้ page id โดยไม่ต้องมี pages_read_engagement
  if (appId && appSecret) {
    const dbg = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    );
    const dj = (await dbg.json().catch(() => ({}))) as {
      data?: { is_valid?: boolean; profile_id?: string; type?: string };
      error?: { message?: string };
    };
    if (dj.error) throw new Error(dj.error.message || "ตรวจ token ไม่สำเร็จ");
    const data = dj.data;
    if (!data?.is_valid) throw new Error("token หมดอายุหรือไม่ถูกต้อง — กด Generate ใหม่");
    if (!data.profile_id) {
      throw new Error("token นี้ไม่ใช่ Page token (ไม่มี page id) — เลือกเพจตอน Generate");
    }
    // ชื่อเพจ (ถ้าอ่านได้) — อ่านไม่ได้ก็ปล่อยว่าง ไม่กระทบการทำงาน
    let name = "";
    try {
      const nr = await fetch(
        `${GRAPH}/${data.profile_id}?fields=name&access_token=${encodeURIComponent(pageToken)}`,
      );
      if (nr.ok) name = String(((await nr.json()) as { name?: string }).name ?? "");
    } catch {
      /* ไม่เป็นไร */
    }
    return { pageId: String(data.profile_id), name };
  }

  // สำรอง: /me (ต้องมี pages_read_engagement)
  const res = await fetch(
    `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`,
  );
  const d = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    error?: { message?: string; type?: string };
  };
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

/* ---------- OAuth "เชื่อม Facebook คลิกเดียว" (Login with Facebook) ---------- */

/** มี credential ระดับแอปพอจะทำ OAuth ไหม (App ID + Secret) */
export function canOAuth(): boolean {
  return Boolean(process.env.FB_APP_ID && process.env.FB_APP_SECRET);
}

/** สร้าง URL ให้ร้านไปล็อกอิน Facebook + เลือกเพจ + ให้สิทธิ์ */
export function buildLoginUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.FB_APP_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  const configId = process.env.FB_LOGIN_CONFIG_ID;
  if (configId) {
    params.set("config_id", configId); // Facebook Login for Business
  } else {
    params.set(
      "scope",
      "pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement",
    );
  }
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

/** แลก code → user access token (แลกต่อเป็น long-lived ด้วย) */
export async function exchangeCodeForUserToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  const appId = process.env.FB_APP_ID ?? "";
  const appSecret = process.env.FB_APP_SECRET ?? "";
  const p1 = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const r1 = await fetch(`${GRAPH}/oauth/access_token?${p1}`);
  const d1 = (await r1.json().catch(() => ({}))) as {
    access_token?: string;
    error?: { message?: string };
  };
  if (!r1.ok || !d1.access_token) {
    throw new Error(d1.error?.message || "แลก token จาก Facebook ไม่สำเร็จ");
  }
  // แลกเป็น long-lived (page token ที่ได้จากนี้จะอยู่ยาว)
  const p2 = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: d1.access_token,
  });
  const r2 = await fetch(`${GRAPH}/oauth/access_token?${p2}`);
  const d2 = (await r2.json().catch(() => ({}))) as { access_token?: string };
  return d2.access_token || d1.access_token;
}

export type FbPage = { id: string; name: string; accessToken: string };

/** ดึงเพจที่ร้านดูแล (พร้อม page access token) */
export async function listPages(userToken: string): Promise<FbPage[]> {
  const params = new URLSearchParams({
    access_token: userToken,
    fields: "id,name,access_token",
    limit: "100",
  });
  const r = await fetch(`${GRAPH}/me/accounts?${params}`);
  const d = (await r.json().catch(() => ({}))) as {
    data?: { id?: string; name?: string; access_token?: string }[];
  };
  return (d.data ?? [])
    .filter((p) => p.id && p.access_token)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name ?? ""),
      accessToken: String(p.access_token),
    }));
}

/** subscribe เพจกับแอป → เพจจะส่ง event ข้อความเข้ามาที่ webhook เรา */
export async function subscribePageToApp(
  pageId: string,
  pageToken: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    subscribed_fields: "messages,messaging_postbacks,messaging_optins",
    access_token: pageToken,
  });
  const r = await fetch(`${GRAPH}/${pageId}/subscribed_apps?${params}`, {
    method: "POST",
  });
  return r.ok;
}
