import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { TokenSet, CatalogItem } from "./marketplace";

/**
 * ตัวเชื่อม TikTok Shop Partner (เจ้าที่ 3 ต่อจาก Lazada/Shopee) — ฝั่งดึงสินค้า
 * - ถ้ายังไม่ตั้ง TIKTOK_APP_KEY/SECRET → ทำงานโหมด mock (จำลองครบ flow)
 * - พอใส่ credentials จริง → สลับไปเรียก API จริงอัตโนมัติ
 *
 * TikTok Shop ใช้ HMAC-SHA256 signing (app_secret + path + params เรียง + body)
 * และ access token อายุสั้น (รีเฟรชด้วย refresh_token)
 */

const HOST = process.env.TIKTOK_API_BASE || "https://open-api.tiktokglobalshop.com";
const AUTH_HOST = process.env.TIKTOK_AUTH_BASE || "https://services.tiktokshop.com";
const TOKEN_HOST = process.env.TIKTOK_TOKEN_BASE || "https://auth.tiktok-shops.com";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 วัน (mock)

export function isTiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET);
}

export function callbackUrl(origin: string): string {
  return process.env.TIKTOK_CALLBACK_URL || `${origin}/api/connect/tiktok/callback`;
}

/** sign แบบ TikTok Shop: HMAC-SHA256(app_secret, path + params เรียงคีย์ + body) */
function sign(path: string, params: Record<string, string>, body = ""): string {
  const secret = process.env.TIKTOK_APP_SECRET as string;
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();
  const base =
    path + sorted.map((k) => `${k}${params[k]}`).join("") + body;
  return createHmac("sha256", secret).update(secret + base + secret).digest("hex");
}

/** URL ให้ผู้ใช้ไป authorize (จริง) หรือ callback จำลอง (mock) */
export function buildAuthUrl(origin: string): string {
  const redirect = callbackUrl(origin);
  if (!isTiktokConfigured()) {
    // โหมด mock: เด้งกลับ callback ของเราเองพร้อม code ปลอม
    return `${redirect}?code=MOCK-${randomBytes(8).toString("hex")}&mock=1`;
  }
  const params = new URLSearchParams({
    app_key: process.env.TIKTOK_APP_KEY as string,
    state: randomBytes(6).toString("hex"),
    redirect_uri: redirect,
  });
  return `${AUTH_HOST}/open/authorize?${params.toString()}`;
}

/* ---------- token ---------- */

export async function exchangeCode(code: string): Promise<TokenSet> {
  if (!isTiktokConfigured() || code.startsWith("MOCK-")) {
    return mockTokens();
  }
  const params = new URLSearchParams({
    app_key: process.env.TIKTOK_APP_KEY as string,
    app_secret: process.env.TIKTOK_APP_SECRET as string,
    auth_code: code,
    grant_type: "authorized_code",
  });
  const res = await fetch(`${TOKEN_HOST}/api/v2/token/get?${params}`, {
    method: "GET",
  });
  const json = (await res.json()) as { data?: Record<string, unknown> };
  const data = json.data ?? {};
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? ""),
    expiresAt: Date.now() + Number(data.access_token_expire_in ?? 604800) * 1000,
    sellerId: String(data.seller_name ?? data.open_id ?? ""),
    mock: false,
  };
}

export async function refreshTokens(
  refreshToken: string,
  _sellerId = "", // TikTok ไม่ใช้ — มีไว้ให้ signature ตรงกับ Shopee
): Promise<TokenSet> {
  if (!isTiktokConfigured() || refreshToken.startsWith("mock-")) {
    return mockTokens();
  }
  const params = new URLSearchParams({
    app_key: process.env.TIKTOK_APP_KEY as string,
    app_secret: process.env.TIKTOK_APP_SECRET as string,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${TOKEN_HOST}/api/v2/token/refresh?${params}`, {
    method: "GET",
  });
  const json = (await res.json()) as { data?: Record<string, unknown> };
  const data = json.data ?? {};
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? refreshToken),
    expiresAt: Date.now() + Number(data.access_token_expire_in ?? 604800) * 1000,
    sellerId: String(data.seller_name ?? ""),
    mock: false,
  };
}

function mockTokens(): TokenSet {
  return {
    accessToken: "mock-access-" + randomBytes(8).toString("hex"),
    refreshToken: "mock-refresh-" + randomBytes(8).toString("hex"),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    sellerId: "mock-tiktok-shop",
    mock: true,
  };
}

/* ---------- catalog ---------- */

export async function fetchCatalog(
  accessToken: string,
  _sellerId = "",
): Promise<CatalogItem[]> {
  if (!isTiktokConfigured() || accessToken.startsWith("mock-")) {
    return MOCK_CATALOG;
  }
  // TikTok Shop Product Search API (v202309)
  const path = "/product/202309/products/search";
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ page_size: 50, status: "ACTIVATE" });
  const params: Record<string, string> = {
    app_key: process.env.TIKTOK_APP_KEY as string,
    timestamp: ts,
  };
  params.sign = sign(path, params, body);
  const qs = new URLSearchParams(params);
  const res = await fetch(`${HOST}${path}?${qs}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tts-access-token": accessToken,
    },
    body,
  });
  const json = (await res.json()) as { data?: { products?: unknown[] } };
  const products = json.data?.products ?? [];
  return products.map((p) => {
    const x = p as Record<string, unknown>;
    const skus = (x.skus as Record<string, unknown>[]) ?? [];
    const price = (skus[0]?.price as Record<string, unknown>) ?? {};
    const mainImages = (x.main_images as Record<string, unknown>[]) ?? [];
    const urlList = (mainImages[0]?.url_list as string[]) ?? [];
    return {
      name: String(x.title ?? ""),
      description: String(x.description ?? ""),
      price: String(price.tax_exclusive_price ?? price.sale_price ?? ""),
      externalId: String(x.id ?? ""),
      image: String(urlList[0] ?? ""),
    };
  });
}

const MOCK_CATALOG: CatalogItem[] = [
  { externalId: "TTS-3001", name: "เซรั่มวิตามินซีหน้าใส 30ml", price: "199", description: "เข้มข้น 20% ผิวกระจ่างใส ลดจุดด่างดำ", image: "https://picsum.photos/seed/TTS-3001/300" },
  { externalId: "TTS-3002", name: "ลิปแมตต์ติดทน 12 ชม.", price: "129", description: "เนื้อแมตต์ละมุน ไม่เป็นคราบ ติดทนทั้งวัน", image: "https://picsum.photos/seed/TTS-3002/300" },
  { externalId: "TTS-3003", name: "เครื่องนวดหน้าไฟฟ้า", price: "350", description: "สั่นกระชับผิว ชาร์จ USB พกพาง่าย", image: "https://picsum.photos/seed/TTS-3003/300" },
  { externalId: "TTS-3004", name: "แปรงแต่งหน้าเซ็ต 12 ชิ้น", price: "159", description: "ขนนุ่มไม่ทิ่ม พร้อมกระเป๋าใส่ ครบชุด", image: "https://picsum.photos/seed/TTS-3004/300" },
  { externalId: "TTS-3005", name: "มาส์กหน้าคอลลาเจน แพ็ก 10", price: "99", description: "เพิ่มความชุ่มชื้น ผิวฉ่ำวาว ใช้ได้ทุกวัน", image: "https://picsum.photos/seed/TTS-3005/300" },
  { externalId: "TTS-3006", name: "ที่หนีบผมไร้สาย พกพา", price: "290", description: "ร้อนเร็วใน 30 วิ ชาร์จ USB-C จัดทรงนอกบ้านสะดวก", image: "https://picsum.photos/seed/TTS-3006/300" },
];
