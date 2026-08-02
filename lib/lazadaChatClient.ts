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
export async function refreshImToken(refreshToken: string): Promise<{
  ok: boolean;
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  error?: string; // code จาก Lazada ตอนล้มเหลว (เช่น IllegalRefreshToken) — ห้ามกลืนเงียบ
}> {
  const { appKey, appSecret } = imAppCreds();
  const fail = (error: string) => ({
    ok: false,
    accessToken: "",
    refreshToken: "",
    expiresAt: null,
    error,
  });
  if (!appKey || !appSecret || !refreshToken) return fail("missing_credentials");
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
    if (!accessToken) {
      return fail(String(data.code ?? data.message ?? `http_${res.status}`));
    }
    const expiresIn = Number(data.expires_in ?? 0);
    return {
      ok: true,
      accessToken,
      refreshToken: String(data.refresh_token ?? refreshToken),
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    };
  } catch {
    return fail("network_error");
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

export type SendResult = { ok: boolean; messageId: string };

/** ส่งข้อความหาลูกค้า — messageId ใช้เก็บเป็น ext_id กัน webhook echo ซ้ำ ("" ถ้าไม่มี/โหมดทดลอง) */
export async function sendMessage(
  accessToken: string,
  sessionId: string,
  text: string,
): Promise<SendResult> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) {
    return { ok: true, messageId: "" };
  }
  try {
    // Lazada IM: ต้องมี template_id="1" (text) + ตัวข้อความใน field "txt" (ยืนยันจาก API จริง)
    const data = await signedCall(
      "/im/message/send",
      accessToken,
      { session_id: sessionId, template_id: "1", txt: text },
      "POST",
    );
    const ok = Number(data.code ?? 0) === 0 || data.code === "0";
    const d = (data.data ?? {}) as Record<string, unknown>;
    return { ok, messageId: ok ? String(d.message_id ?? "") : "" };
  } catch {
    return { ok: false, messageId: "" };
  }
}

/**
 * ส่ง "การ์ดสินค้า" (template_id 10006) — ลูกค้ากดแล้วเปิดหน้าสินค้า/หยิบใส่ตะกร้าได้เลย
 * ใช้ตามหลังข้อความแนะนำสินค้า (feedback: AI แนะนำแล้วลูกค้าหาสินค้าไม่เจอ)
 */
export async function sendItemCard(
  accessToken: string,
  sessionId: string,
  itemId: string,
): Promise<SendResult> {
  if (isMock(accessToken) || !sessionId || sessionId.startsWith("mock-")) {
    return { ok: true, messageId: "" };
  }
  if (!itemId) return { ok: false, messageId: "" };
  try {
    const data = await signedCall(
      "/im/message/send",
      accessToken,
      { session_id: sessionId, template_id: "10006", item_id: itemId },
      "POST",
    );
    const ok = Number(data.code ?? 0) === 0 || data.code === "0";
    const d = (data.data ?? {}) as Record<string, unknown>;
    return { ok, messageId: ok ? String(d.message_id ?? "") : "" };
  } catch {
    return { ok: false, messageId: "" };
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

export type LzSession = {
  sessionId: string;
  title: string;
  buyerId: string;
  lastMessageTime: number; // epoch ms ของข้อความล่าสุดใน session
};

/**
 * รายชื่อ session ที่มีความเคลื่อนไหวตั้งแต่ sinceMs — ใช้ poll หาแชตใหม่ (กันกรณี push ของ Lazada หยุด)
 * /im/session/list คืน session ไล่ย้อนหลังจาก start_time (เหมือน message/list) → ไล่ pagination จนเลย sinceMs
 */
/** ตรวจว่า access token ยังใช้ได้จริงกับ Lazada (เรียก session list ถูกสุด 1 หน้า) — คืน code ("0" = ปกติ)
 *  บทเรียน 3 ส.ค.: token ตายก่อน expires_at ที่จดไว้ ~6 วัน ระบบเชื่อวันหมดอายุเลยเงียบไป 3 วัน */
export async function probeImToken(accessToken: string): Promise<string> {
  if (isMock(accessToken)) return "0";
  try {
    const data = await signedCall("/im/session/list", accessToken, {
      start_time: String(Date.now()),
      page_size: "1",
    });
    return String(data.code ?? "0");
  } catch {
    return "network_error"; // เน็ตล้ม ≠ token ตาย — ผู้เรียกอย่าเพิ่ง mark dead
  }
}

export async function listRecentSessions(
  accessToken: string,
  sinceMs: number,
): Promise<LzSession[]> {
  if (isMock(accessToken)) return [];
  const found = new Map<string, LzSession>();
  let start = String(Date.now());
  for (let page = 0; page < 40; page++) {
    let data: Record<string, unknown>;
    try {
      data = await signedCall("/im/session/list", accessToken, {
        start_time: start,
        page_size: "20",
      });
    } catch {
      break;
    }
    const d = (data.data ?? {}) as Record<string, unknown>;
    const list = Array.isArray(d.session_list) ? (d.session_list as Record<string, unknown>[]) : [];
    if (list.length === 0) break;
    let oldest = Infinity;
    for (const s of list) {
      const sid = String(s.session_id ?? "");
      if (!sid) continue;
      const lastMs = Number(s.last_message_time ?? 0);
      if (lastMs) oldest = Math.min(oldest, lastMs);
      if (!found.has(sid)) {
        found.set(sid, {
          sessionId: sid,
          title: String(s.title ?? ""),
          buyerId: String(s.buyer_id ?? s.buyer_user_id ?? ""),
          lastMessageTime: lastMs,
        });
      }
    }
    if (oldest !== Infinity && oldest < sinceMs) break; // เลยช่วงที่สนใจแล้ว
    const next = Number(d.next_start_time ?? 0) || (oldest !== Infinity ? oldest - 1 : 0);
    if (!next || String(next) === start) break;
    start = String(next);
  }
  return [...found.values()].filter((s) => !s.lastMessageTime || s.lastMessageTime >= sinceMs);
}

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
