import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { TokenSet, CatalogItem } from "./marketplace";

/**
 * ตัวเชื่อม Shopee Open Platform (เจ้าที่ 2 ต่อจาก Lazada)
 * - ถ้ายังไม่ตั้ง SHOPEE_PARTNER_ID/KEY → ทำงานโหมด mock (จำลองครบ flow)
 * - พอใส่ credentials จริง → สลับไปเรียก API จริงอัตโนมัติ
 *
 * ต่าง Lazada ตรงที่:
 * - signing = HMAC-SHA256 ของ (partner_id + path + timestamp [+ access_token + shop_id])
 * - callback ส่ง code มาพร้อม shop_id, ต้องใช้ shop_id ทั้งตอนแลก token และดึงสินค้า
 * - access token อายุสั้น (~4 ชม.) refresh บ่อยกว่า
 */

const HOST = process.env.SHOPEE_API_BASE || "https://partner.shopeemobile.com";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 4; // 4 ชม. (mock)

export function isShopeeConfigured(): boolean {
  return Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
}

export function callbackUrl(origin: string): string {
  return process.env.SHOPEE_CALLBACK_URL || `${origin}/api/connect/shopee/callback`;
}

/* ---------- signing (Shopee ใช้ HMAC-SHA256, base ขึ้นต้นด้วย partner_id+path+timestamp) ---------- */

function signed(path: string, extra = ""): { ts: number; sign: string } {
  const partnerId = process.env.SHOPEE_PARTNER_ID as string;
  const key = process.env.SHOPEE_PARTNER_KEY as string;
  const ts = Math.floor(Date.now() / 1000);
  const base = `${partnerId}${path}${ts}${extra}`;
  const sign = createHmac("sha256", key).update(base).digest("hex");
  return { ts, sign };
}

/** URL ให้ผู้ใช้ไป authorize (จริง) หรือ callback จำลอง (mock) */
export function buildAuthUrl(origin: string): string {
  const redirect = callbackUrl(origin);
  if (!isShopeeConfigured()) {
    // โหมด mock: เด้งกลับ callback ของเราเองพร้อม code + shop_id ปลอม
    return `${redirect}?code=MOCK-${randomBytes(8).toString("hex")}&shop_id=0&mock=1`;
  }
  const path = "/api/v2/shop/auth_partner";
  const { ts, sign } = signed(path);
  const params = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID as string,
    timestamp: String(ts),
    sign,
    redirect,
  });
  return `${HOST}${path}?${params.toString()}`;
}

/* ---------- token ---------- */

export async function exchangeCode(code: string, shopId: string): Promise<TokenSet> {
  if (!isShopeeConfigured() || code.startsWith("MOCK-")) {
    return mockTokens();
  }
  const path = "/api/v2/auth/token/get";
  const { ts, sign } = signed(path);
  const params = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID as string,
    timestamp: String(ts),
    sign,
  });
  const res = await fetch(`${HOST}${path}?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(process.env.SHOPEE_PARTNER_ID),
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? ""),
    expiresAt: Date.now() + Number(data.expire_in ?? 14400) * 1000,
    sellerId: shopId,
    mock: false,
  };
}

export async function refreshTokens(
  refreshToken: string,
  sellerId = "",
): Promise<TokenSet> {
  if (!isShopeeConfigured() || refreshToken.startsWith("mock-")) {
    return { ...mockTokens(), sellerId: sellerId || "mock-shop-88" };
  }
  const path = "/api/v2/auth/access_token/get";
  const { ts, sign } = signed(path);
  const params = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID as string,
    timestamp: String(ts),
    sign,
  });
  const res = await fetch(`${HOST}${path}?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: Number(sellerId),
      partner_id: Number(process.env.SHOPEE_PARTNER_ID),
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? refreshToken),
    expiresAt: Date.now() + Number(data.expire_in ?? 14400) * 1000,
    sellerId,
    mock: false,
  };
}

function mockTokens(): TokenSet {
  return {
    accessToken: "mock-access-" + randomBytes(8).toString("hex"),
    refreshToken: "mock-refresh-" + randomBytes(8).toString("hex"),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    sellerId: "mock-shop-88",
    mock: true,
  };
}

/* ---------- catalog ---------- */

export async function fetchCatalog(
  accessToken: string,
  shopId = "",
): Promise<CatalogItem[]> {
  if (!isShopeeConfigured() || accessToken.startsWith("mock-")) {
    return MOCK_CATALOG;
  }

  // 1) ดึงรายการ item_id ของร้าน
  const listPath = "/api/v2/product/get_item_list";
  const s1 = signed(listPath, `${accessToken}${shopId}`);
  const listParams = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID as string,
    timestamp: String(s1.ts),
    sign: s1.sign,
    access_token: accessToken,
    shop_id: shopId,
    offset: "0",
    page_size: "50",
    item_status: "NORMAL",
  });
  const listRes = await fetch(`${HOST}${listPath}?${listParams}`, { method: "GET" });
  const listData = (await listRes.json()) as Record<string, unknown>;
  const listResp = (listData.response as Record<string, unknown>) ?? {};
  const items = (listResp.item as Record<string, unknown>[]) ?? [];
  const ids = items.map((x) => String(x.item_id)).filter(Boolean);
  if (!ids.length) return [];

  // 2) ดึงรายละเอียดสินค้าจาก item_id
  const infoPath = "/api/v2/product/get_item_base_info";
  const s2 = signed(infoPath, `${accessToken}${shopId}`);
  const infoParams = new URLSearchParams({
    partner_id: process.env.SHOPEE_PARTNER_ID as string,
    timestamp: String(s2.ts),
    sign: s2.sign,
    access_token: accessToken,
    shop_id: shopId,
    item_id_list: ids.join(","),
  });
  const infoRes = await fetch(`${HOST}${infoPath}?${infoParams}`, { method: "GET" });
  const infoData = (await infoRes.json()) as Record<string, unknown>;
  const infoResp = (infoData.response as Record<string, unknown>) ?? {};
  const list = (infoResp.item_list as Record<string, unknown>[]) ?? [];

  return list.map((p) => {
    const priceInfo = (p.price_info as Record<string, unknown>[]) ?? [];
    return {
      name: String(p.item_name ?? ""),
      description: String(p.description ?? ""),
      price: String(priceInfo[0]?.current_price ?? ""),
      externalId: String(p.item_id ?? ""),
    };
  });
}

const MOCK_CATALOG: CatalogItem[] = [
  { externalId: "SHP-2001", name: "เคสกันกระแทกใส iPhone 15", price: "159", description: "ขอบยกสูงกันกล้อง วัสดุ TPU นิ่มไม่เหลือง" },
  { externalId: "SHP-2002", name: "ฟิล์มกระจกกันรอยเต็มจอ", price: "89", description: "ความแข็ง 9H ติดง่ายไร้ฟองอากาศ แพ็ก 2 ชิ้น" },
  { externalId: "SHP-2003", name: "สายชาร์จเร็ว Type-C 65W 1.5m", price: "129", description: "ถักไนลอนทนทาน รองรับชาร์จไว PD/QC" },
  { externalId: "SHP-2004", name: "หูฟังบลูทูธ TWS เสียงดี", price: "390", description: "ตัดเสียงรบกวน แบตอึด 24 ชม. กันน้ำ IPX5" },
  { externalId: "SHP-2005", name: "พาวเวอร์แบงค์ 20000mAh", price: "459", description: "ชาร์จเร็ว 22.5W 2 พอร์ต จอแสดงเปอร์เซ็นต์" },
  { externalId: "SHP-2006", name: "ขาตั้งมือถือปรับระดับ", price: "75", description: "อะลูมิเนียมพับเก็บได้ ตั้งดูคลิป/วิดีโอคอลสะดวก" },
];
