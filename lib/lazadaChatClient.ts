import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/**
 * ตัวเชื่อมแชต Lazada (IM) — รับ/ส่งข้อความ
 * - access token ขึ้นต้น mock- (หรือว่าง) → โหมดทดลอง ไม่ยิง API จริง
 * - LAZADA_CHAT_SECRET เป็นระดับแอป (env) ใช้ verify ลายเซ็น webhook (push notification)
 *
 * หมายเหตุ: แชต Lazada มักเป็น "แอปแยก" (หมวด In-house IM Chat คนละแอปกับตัวดึงสินค้า)
 * จึงใช้คีย์ของแอปแชตเอง LAZADA_IM_APP_KEY/SECRET ถ้าตั้งไว้ ไม่งั้น fallback ไป LAZADA_APP_KEY/SECRET
 * โค้ดส่วน "จริง" เป็น best-effort ตามรูปแบบ Lazada Open Platform — พอได้สิทธิ์ IM จริงค่อยปรับ endpoint
 */

/** คีย์ของแอปแชต (IM) — แยกจากแอปดึงสินค้าได้ ถ้าไม่ตั้งให้ fallback ไปใช้คีย์หลัก */
function imAppCreds(): { appKey: string; appSecret: string } {
  return {
    appKey: (process.env.LAZADA_IM_APP_KEY || process.env.LAZADA_APP_KEY || "") as string,
    appSecret: (process.env.LAZADA_IM_APP_SECRET ||
      process.env.LAZADA_APP_SECRET ||
      "") as string,
  };
}

const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";
const AUTH_URL = "https://auth.lazada.com/oauth/authorize";

function isMock(token: string): boolean {
  return !token || token.startsWith("mock-");
}

/** ตั้ง secret ระดับแอปสำหรับ verify webhook แล้วหรือยัง */
export function isLazadaChatConfigured(): boolean {
  return Boolean(process.env.LAZADA_CHAT_SECRET);
}

/**
 * verify ลายเซ็น webhook ของ Lazada IM push
 * สูตรจริง (ยืนยันจาก push จริง): HMAC-SHA256(secret = app_secret, message = app_key + rawBody) → hex
 */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
  appKey = "",
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(appKey + rawBody).digest("hex");
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
  const { appKey, appSecret } = imAppCreds();
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

/* ---------- OAuth ของแอปแชต (IM) เพื่อขอ access token ---------- */

/** URL ให้ร้านล็อกอิน Lazada เพื่ออนุญาตแอปแชต (state=imchat ให้ callback รู้ว่าเป็นฝั่งแชต) */
export function buildImAuthUrl(origin: string): string {
  const { appKey } = imAppCreds();
  const params = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: `${origin}/api/connect/lazada/callback`,
    client_id: appKey,
    state: "imchat",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type ImTokenResult = {
  ok: boolean;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  name: string;
  expiresAt: number | null; // epoch ms ที่ access token หมดอายุ
};

/** ต่ออายุ access token ด้วย refresh token (Lazada /auth/token/refresh) */
export async function refreshImToken(
  refreshToken: string,
): Promise<{ ok: boolean; accessToken: string; refreshToken: string; expiresAt: number | null }> {
  const { appKey, appSecret } = imAppCreds();
  const fail = { ok: false, accessToken: "", refreshToken: "", expiresAt: null };
  if (!appKey || !appSecret || !refreshToken) return fail;
  const path = "/auth/token/refresh";
  const params: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    refresh_token: refreshToken,
  };
  params.sign = sign(path, params, appSecret);
  try {
    const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`);
    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) return fail;
    const expiresIn = Number(data.expires_in ?? 0);
    return {
      ok: true,
      accessToken,
      refreshToken: String(data.refresh_token ?? refreshToken),
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    };
  } catch {
    return fail;
  }
}

/** แลก authorization code → access token ของแอปแชต + ดึง seller id จาก response */
export async function exchangeImCode(code: string): Promise<ImTokenResult> {
  const empty: ImTokenResult = {
    ok: false,
    accessToken: "",
    refreshToken: "",
    accountId: "",
    name: "",
    expiresAt: null,
  };
  const { appKey, appSecret } = imAppCreds();
  if (!appKey || !appSecret || !code) return empty;

  const path = "/auth/token/create";
  const params: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    code,
  };
  params.sign = sign(path, params, appSecret);

  try {
    const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`);
    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");
    if (!accessToken) return empty;
    const cui = Array.isArray(data.country_user_info)
      ? (data.country_user_info[0] as Record<string, unknown> | undefined)
      : undefined;
    const accountId = String(cui?.seller_id ?? cui?.short_code ?? data.account ?? "");
    const name = String(data.account ?? cui?.seller_id ?? "");
    const expiresIn = Number(data.expires_in ?? 0);
    return {
      ok: true,
      accessToken,
      refreshToken: String(data.refresh_token ?? ""),
      accountId,
      name,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    };
  } catch {
    return empty;
  }
}

/** ส่งข้อความหาลูกค้า — true ถ้าสำเร็จ (หรือโหมดทดลอง) */
export async function sendMessage(
  accessToken: string,
  sessionId: string,
  text: string,
): Promise<boolean> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) return true;
  try {
    // Lazada IM: ต้องมี template_id="1" (text) + ตัวข้อความใน field "txt" (ยืนยันจาก API จริง)
    const data = await signedCall(
      "/im/message/send",
      accessToken,
      { session_id: sessionId, template_id: "1", txt: text },
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

/**
 * ดึงชื่อลูกค้า = title ของ session (จาก /im/session/get)
 * หมายเหตุ: ถ้าแอปตั้ง Sensitive Data = Mask ชื่อจะถูกปิดบัง (เช่น "R****l") — ต้อง Apply Unmask ใน console ถึงได้ชื่อเต็ม
 * คืน "" ถ้าไม่ได้/โหมดทดลอง → ผู้เรียก fallback เป็น "ลูกค้า"
 */
export async function fetchUserName(
  accessToken: string,
  sessionId: string,
): Promise<string> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) return "";
  try {
    const data = await signedCall("/im/session/get", accessToken, { session_id: sessionId });
    const d = (data.data ?? {}) as Record<string, unknown>;
    return typeof d.title === "string" ? d.title.trim() : "";
  } catch {
    return "";
  }
}

/** แกะข้อความจาก object (รองรับ txt / th=greeting / itemId=การ์ดสินค้า) */
function pickText(c: Record<string, unknown>): string | null {
  if (typeof c.txt === "string") return c.txt;
  if (typeof c.th === "string") return c.th;
  if (typeof c.en === "string") return c.en;
  if (c.itemId) return `[สินค้า] ${c.title ?? c.itemId}${c.price ? ` ${c.price}` : ""}`;
  return null;
}

/**
 * แกะ content ของข้อความ Lazada IM → ข้อความอ่านได้
 * บางข้อความ (เช่น auto-greeting) txt เป็น JSON ซ้อน {"th":...,"en":...} → แกะอีกชั้น
 */
function histText(content: unknown): string {
  if (typeof content !== "string") return "";
  if (/<img[^>]*\bsrc=/i.test(content)) return "[รูปภาพ]"; // รูปส่งมาเป็น HTML <img>
  let txt: string | null;
  try {
    txt = pickText(JSON.parse(content) as Record<string, unknown>);
  } catch {
    return content; // ไม่ใช่ JSON (เช่น ลิงก์) → ใช้ตามนั้น
  }
  if (txt === null) return content;
  // txt เป็น JSON ซ้อน ({"th":...}) → แกะชั้นใน
  if (txt.trim().startsWith("{")) {
    try {
      const inner = pickText(JSON.parse(txt) as Record<string, unknown>);
      if (inner !== null) return inner;
    } catch {
      /* คง txt เดิม */
    }
  }
  return txt;
}

export type LzHistoryMsg = {
  sender: "customer" | "admin";
  text: string;
  extId: string;
  createdAt: number;
};

/**
 * ดึงประวัติแชตทั้งหมดของ session (เรียงเก่า→ใหม่)
 * Lazada IM: /im/message/list คืนข้อความ "ย้อนหลังจาก start_time" (start_time=now ไล่ลง, page_size≤20)
 */
export async function fetchHistory(
  accessToken: string,
  sessionId: string,
): Promise<LzHistoryMsg[]> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) return [];
  const out: LzHistoryMsg[] = [];
  let start = String(Date.now());
  for (let i = 0; i < 30; i++) {
    let data: Record<string, unknown>;
    try {
      data = await signedCall("/im/message/list", accessToken, {
        session_id: sessionId,
        start_time: start,
        page_size: "20",
      });
    } catch {
      break;
    }
    const d = (data.data ?? {}) as {
      message_list?: Record<string, unknown>[];
      has_more?: boolean;
      next_start_time?: number;
    };
    const ml = Array.isArray(d.message_list) ? d.message_list : [];
    for (const m of ml) {
      const text = histText(m.content);
      const extId = String(m.message_id ?? "");
      if (!text.trim() || !extId) continue;
      out.push({
        sender: Number(m.from_account_type) === 1 ? "customer" : "admin",
        text,
        extId,
        createdAt: Number(m.send_time) || Date.now(),
      });
    }
    if (!d.has_more || !ml.length || !d.next_start_time) break;
    start = String(d.next_start_time);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
