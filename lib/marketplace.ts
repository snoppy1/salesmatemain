import "server-only";
import { createHmac, randomBytes } from "node:crypto";

/**
 * ตัวเชื่อม Lazada Open Platform
 * - ถ้ายังไม่ตั้ง LAZADA_APP_KEY/SECRET → ทำงานโหมด mock (จำลองครบ flow)
 * - พอใส่ credentials จริง → สลับไปเรียก API จริงอัตโนมัติ
 */

const AUTH_URL = "https://auth.lazada.com/oauth/authorize";
const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 วัน (ตาม spec)

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sellerId: string;
  mock: boolean;
};

export type CatalogItem = {
  name: string;
  price: string;
  description: string;
  externalId: string;
  image?: string; // URL รูปสินค้าจาก marketplace (ว่างได้)
  stock?: number; // จำนวนคงเหลือจาก marketplace (ว่าง = ไม่ระบุ)
};

export function isLazadaConfigured(): boolean {
  return Boolean(process.env.LAZADA_APP_KEY && process.env.LAZADA_APP_SECRET);
}

export function callbackUrl(origin: string): string {
  return process.env.LAZADA_CALLBACK_URL || `${origin}/api/connect/lazada/callback`;
}

/** URL ให้ผู้ใช้ไป authorize (จริง) หรือ callback จำลอง (mock) */
export function buildAuthUrl(origin: string): string {
  const redirect = callbackUrl(origin);
  if (!isLazadaConfigured()) {
    // โหมด mock: เด้งกลับ callback ของเราเองพร้อม code ปลอม
    return `${redirect}?code=MOCK-${randomBytes(8).toString("hex")}&mock=1`;
  }
  const params = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: redirect,
    client_id: process.env.LAZADA_APP_KEY as string,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/* ---------- signing (Lazada ใช้ HMAC-SHA256) ---------- */

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const base = path + sorted.map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

async function signedCall(
  path: string,
  extra: Record<string, string>,
): Promise<Record<string, unknown>> {
  const appKey = process.env.LAZADA_APP_KEY as string;
  const appSecret = process.env.LAZADA_APP_SECRET as string;
  const params: Record<string, string> = {
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    ...extra,
  };
  params.sign = sign(path, params, appSecret);
  const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`, {
    method: "GET",
  });
  return (await res.json()) as Record<string, unknown>;
}

/* ---------- token ---------- */

export async function exchangeCode(code: string): Promise<TokenSet> {
  if (!isLazadaConfigured() || code.startsWith("MOCK-")) {
    return mockTokens();
  }
  const data = await signedCall("/auth/token/create", { code });
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? ""),
    expiresAt: Date.now() + Number(data.expires_in ?? 604800) * 1000,
    sellerId: String((data.country_user_info as unknown) ?? data.account ?? ""),
    mock: false,
  };
}

export async function refreshTokens(
  refreshToken: string,
  _sellerId = "", // Lazada ไม่ใช้ — มีไว้ให้ signature ตรงกับ Shopee
): Promise<TokenSet> {
  if (!isLazadaConfigured() || refreshToken.startsWith("mock-")) {
    return mockTokens();
  }
  const data = await signedCall("/auth/token/refresh", { refresh_token: refreshToken });
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? refreshToken),
    expiresAt: Date.now() + Number(data.expires_in ?? 604800) * 1000,
    sellerId: String(data.account ?? ""),
    mock: false,
  };
}

function mockTokens(): TokenSet {
  return {
    accessToken: "mock-access-" + randomBytes(8).toString("hex"),
    refreshToken: "mock-refresh-" + randomBytes(8).toString("hex"),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    sellerId: "mock-seller-001",
    mock: true,
  };
}

/* ---------- catalog ---------- */

export async function fetchCatalog(accessToken: string): Promise<CatalogItem[]> {
  if (!isLazadaConfigured() || accessToken.startsWith("mock-")) {
    return MOCK_CATALOG;
  }
  const data = await signedCall("/products/get", {
    access_token: accessToken,
    filter: "live",
    limit: "50",
  });
  const products =
    ((data.data as Record<string, unknown> | undefined)?.products as unknown[]) ?? [];
  return products.map((p) => {
    const x = p as Record<string, unknown>;
    const attrs = (x.attributes ?? {}) as Record<string, unknown>;
    const skus = (x.skus as Record<string, unknown>[]) ?? [];
    const images = (x.images as string[]) ?? [];
    const qty = skus[0]?.quantity ?? skus[0]?.Available ?? skus[0]?.SellableQuantity;
    return {
      name: String(attrs.name ?? ""),
      description: String(attrs.short_description ?? attrs.description ?? ""),
      price: String(skus[0]?.price ?? ""),
      externalId: String(x.item_id ?? ""),
      image: String(images[0] ?? skus[0]?.Images ?? ""),
      stock: qty != null ? Number(qty) : undefined,
    };
  });
}

const MOCK_CATALOG: CatalogItem[] = [
  { externalId: "LZD-1001", name: "แบตเตอรี่รถยนต์ GS 12V 65Ah", price: "2390", description: "แบตแห้งกึ่ง MF พร้อมใช้ ประกัน 18 เดือน", image: "https://picsum.photos/seed/LZD-1001/300", stock: 24 },
  { externalId: "LZD-1002", name: "น้ำมันเครื่องสังเคราะห์ 5W-30 4L", price: "1290", description: "สังเคราะห์แท้ 100% ยืดอายุเครื่องยนต์", image: "https://picsum.photos/seed/LZD-1002/300", stock: 60 },
  { externalId: "LZD-1003", name: "ใบปัดน้ำฝนไร้โครง 24 นิ้ว", price: "350", description: "ยางซิลิโคนรีดน้ำเงียบ ทนแดด", image: "https://picsum.photos/seed/LZD-1003/300", stock: 0 },
  { externalId: "LZD-1004", name: "สายพ่วงแบตเตอรี่ทองแดงแท้ 2000A", price: "590", description: "หนีบแน่น ทองแดงเต็ม ยาว 3 เมตร", image: "https://picsum.photos/seed/LZD-1004/300", stock: 15 },
  { externalId: "LZD-1005", name: "เครื่องชาร์จแบตอัจฉริยะ 12V/24V", price: "1190", description: "ตัดไฟอัตโนมัติ ชาร์จได้ทุกชนิดแบต", image: "https://picsum.photos/seed/LZD-1005/300", stock: 8 },
  { externalId: "LZD-1006", name: "น้ำยาเติมหม้อน้ำ Coolant 1L", price: "120", description: "ป้องกันสนิม ลดความร้อนสะสม", image: "https://picsum.photos/seed/LZD-1006/300", stock: 120 },
];
