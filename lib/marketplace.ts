import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { withLiveStock } from "./mockStock";

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
  variantOptions?: string; // ตัวเลือกสินค้า เช่น "สีส้ม/สีเขียว" (ว่าง = ไม่มีตัวเลือก) — ต่อท้าย description ทีหลังด้วย withVariantNote
};

export function isLazadaConfigured(): boolean {
  return Boolean(process.env.LAZADA_APP_KEY && process.env.LAZADA_APP_SECRET);
}

export function callbackUrl(origin: string): string {
  return process.env.LAZADA_CALLBACK_URL || `${origin}/api/connect/lazada/callback`;
}

/** URL ให้ผู้ใช้ไป authorize (จริง) หรือ callback จำลอง (mock)
 * forceMock = true → บังคับโหมด mock แม้ตั้ง env จริงไว้ (ตามสวิตช์ "ข้อมูลทดลอง") */
export function buildAuthUrl(origin: string, forceMock = false): string {
  const redirect = callbackUrl(origin);
  if (forceMock || !isLazadaConfigured()) {
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

/** แปลง HTML จาก Lazada เป็นข้อความล้วน (ตัด tag + decode entity + ตัดความยาว) */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, " ") // จบบรรทัด → เว้นวรรค
    .replace(/<[^>]*>/g, " ") // ตัด tag ที่เหลือ
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 500 ? text.slice(0, 500).trim() + "…" : text;
}

/**
 * ดึง "ตัวเลือกสินค้า" (สี/ไซส์/แบบ) จากทุก SKU — Lazada เก็บใน sku.saleProp เช่น {color_family: "สีส้ม"}
 * เดิมเราอ่านแค่ skus[0] ทำให้ AI ไม่รู้ว่าสินค้ามีหลายสี → ลูกค้าถาม "สีเขียว" แล้ว AI
 * ไปมโนว่าเป็นสินค้าคนละตัว (feedback ร้าน Smarttech 25 ก.ค.) — เก็บครบทุก SKU กันเคสนี้
 */
export function extractVariantOptions(skus: Record<string, unknown>[]): string {
  const byProp = new Map<string, string[]>(); // ชื่อ prop → ค่าไม่ซ้ำ เรียงตามที่เจอ
  for (const sku of skus) {
    const sp = (sku?.saleProp ?? sku?.SaleProp) as Record<string, unknown> | undefined;
    if (!sp || typeof sp !== "object") continue;
    for (const [k, v] of Object.entries(sp)) {
      const val = String(v ?? "").trim();
      if (!val) continue;
      const list = byProp.get(k) ?? [];
      if (!list.includes(val)) list.push(val);
      byProp.set(k, list);
    }
  }
  const MAX_SHOWN = 8; // กันสินค้าที่ตัวเลือกเยอะมาก (เช่น เคส 30 ลาย) บวม token
  const groups: string[] = [];
  for (const vals of byProp.values()) {
    if (vals.length < 2) continue; // ค่าเดียว = ไม่มีอะไรให้เลือก ไม่ต้องเปลืองที่
    const shown = vals.slice(0, MAX_SHOWN).join("/");
    groups.push(vals.length > MAX_SHOWN ? `${shown} +อีก ${vals.length - MAX_SHOWN} แบบ` : shown);
  }
  return groups.join(" · ");
}

/**
 * ต่อท้าย "มีให้เลือก: …" เข้า description — ต้องเรียก "หลัง" ย่อ description ด้วย AI แล้วเท่านั้น
 * (ถ้าต่อก่อนย่อ ตัวย่ออาจตัดทิ้ง) ใช้ทั้งขา import และขา sync ที่เพิ่มสินค้าใหม่
 */
export function withVariantNote(description: string, variantOptions?: string): string {
  const v = (variantOptions ?? "").trim();
  if (!v) return description;
  const note = `มีให้เลือก: ${v}`;
  if (description.includes(note)) return description;
  return description ? `${description} · ${note}` : note;
}

/** แปลง 1 product จาก Lazada → CatalogItem */
function mapLazadaProduct(p: unknown): CatalogItem {
  const x = p as Record<string, unknown>;
  const attrs = (x.attributes ?? {}) as Record<string, unknown>;
  const skus = (x.skus as Record<string, unknown>[]) ?? [];
  const images = (x.images as string[]) ?? [];
  const qty = skus[0]?.quantity ?? skus[0]?.Available ?? skus[0]?.SellableQuantity;
  return {
    name: String(attrs.name ?? ""),
    description: htmlToText(String(attrs.short_description ?? attrs.description ?? "")),
    price: String(skus[0]?.price ?? ""),
    externalId: String(x.item_id ?? ""),
    image: String(images[0] ?? skus[0]?.Images ?? ""),
    stock: qty != null ? Number(qty) : undefined,
    variantOptions: extractVariantOptions(skus) || undefined,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ดึงสินค้าตาม filter หนึ่งค่า (แบ่งหน้า + retry + กัน rate-limit) — คืนเท่าที่ดึงได้ */
async function fetchByFilter(accessToken: string, filter: string): Promise<CatalogItem[]> {
  const LIMIT = 50;
  const MAX_PAGES = 60; // กันวนไม่จบ (รองรับสูงสุด ~3,000 สินค้า/filter)
  const GAP_MS = 300; // หน่วงระหว่างหน้า กัน Lazada rate-limit ตอนยิงรัวๆ
  const out: CatalogItem[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(GAP_MS);
    let products: unknown[] = [];
    let total = 0;
    // ยิงหน้านี้ + retry 1 ครั้งถ้าพลาด/ติด rate-limit (Lazada code != "0")
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await signedCall("/products/get", {
          access_token: accessToken,
          filter,
          limit: String(LIMIT),
          offset: String(page * LIMIT),
        });
        const d = (data.data as Record<string, unknown> | undefined) ?? {};
        products = (d.products as unknown[]) ?? [];
        total = Number(d.total_products ?? 0);
        const ok = String((data as Record<string, unknown>).code ?? "0") === "0";
        if (ok || attempt === 1) break;
        await sleep(1000); // error → พักแล้วลองใหม่ 1 ครั้ง
      } catch {
        if (attempt === 1) break;
        await sleep(1000);
      }
    }
    if (products.length === 0) break; // หน้าเปล่า/พลาดซ้ำ → คืนเท่าที่ดึงได้ (ดีกว่าล้มทั้งหมด)
    for (const p of products) out.push(mapLazadaProduct(p));
    if (total > 0 && out.length >= total) break; // ดึงครบตามจำนวนจริงแล้ว
    if (products.length < LIMIT) break; // หน้าสุดท้าย (ไม่เต็มหน้า)
  }
  return out;
}

export async function fetchCatalog(accessToken: string): Promise<CatalogItem[]> {
  if (!isLazadaConfigured() || accessToken.startsWith("mock-")) {
    return withLiveStock(MOCK_CATALOG);
  }
  // "แอคทีฟ" ใน Lazada = live (มีของ) + sold-out (ขายหมดแต่ยังโพสต์อยู่)
  // filter=live ได้เฉพาะที่มีของ → ต้องดึง sold-out ด้วย AI จะได้ตอบ "หมดแล้ว" ไม่ใช่ "ไม่มีสินค้านี้"
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const filter of ["live", "sold-out"]) {
    for (const it of await fetchByFilter(accessToken, filter)) {
      if (it.externalId && seen.has(it.externalId)) continue; // กันซ้ำข้าม filter
      if (it.externalId) seen.add(it.externalId);
      out.push(it);
    }
  }
  return out;
}

// แคตตาล็อกตัวอย่างสำหรับโหมดทดลอง — แบตเตอรี่/ที่ชาร์จจริงจากร้าน Nathapat (ข้อมูล/รูปจริง) 30 รายการ
const MOCK_CATALOG: CatalogItem[] = [
  {"externalId":"5688805521","name":"แบตเตอรี่ จักรยานไฟฟ้า สกู๊ตเตอร์ไฟฟ้า LiFePO4 60V 20Ah  อายุการใช้งานยาวนาน ปลอดภัยไม่ติดไฟ","price":"8100","description":"LiFePO4 รองรับ 2,000–3,000 รอบชาร์จ ใช้กับรถจักรยานไฟฟ้า สกู๊ตเตอร์ไฟฟ้า ระบบโซลาร์","image":"https://th-live.slatic.net/p/90cebc666c617ac2b95ae3ce181bec4c.png","stock":18},
  {"externalId":"5280324670","name":"แบตเตอรี่สามล้อไฟฟ้า 48V20AH แอมป์แท้ ทนจริง Lifepo4  BMS30A แบตเตอรี่สกุ๊ตเตอร์ไฟฟ้า","price":"5500","description":"Exzellent 48V 20Ah LiFePO4 จักรยาน/สามล้อไฟฟ้า วัดความจุจริง 20.2Ah ขั้วทั่วไป วางได้ทุกแนว ต่อขนานเพิ่มความจุได้","image":"https://th-live.slatic.net/p/9128e7b9fda2078290f42b45da3fb914.jpg","stock":25},
  {"externalId":"4908000911","name":"✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-S12 เครื่องชาร์จถ่าน ราง 12 ช่อง สำหรับ ถ่าน18650 ถ่านAA ถ่านAAA Ni-MH / Li-ion / LiFePo4 / 9V คุณภาพสูง ของแท้ 100% ประกัน1ปีเต็ม","price":"1250","description":"อินพุต DC 12V/3.5A | เอาต์พุต DC 4.2V/1.48V/3.65V/4.35V/9V | กระแสชาร์จ Li: 1000mA×6/500mA×12, NiMH: 500mA×12, 9V: 85mA×2 | รองรับ: 26650/21700/18650/18350/2065","image":"https://th-live.slatic.net/p/7aae5d2209a7ebfcf6661bf4f7975716.jpg","stock":34},
  {"externalId":"5688856082","name":"แบตเตอรี่ มอเตอร์ไซค์ไฟฟ้า รถกอล์ฟไฟฟ้า LiFePO4 48V 45Ah  อายุการใช้งานยาวนาน ปลอดภัยไม่ติดไฟ","price":"11800","description":"แบตเตอรี่ LiFePO4 รองรับ 2,000–3,000 รอบชาร์จ ใช้กับมอเตอร์ไซค์ไฟฟ้า, รถกอล์ฟไฟฟ้า, รถไฟฟ้า, UPS และระบบสำรองไฟ","image":"https://th-live.slatic.net/p/9642dc40656bb0506477852ffe8e376b.png","stock":20},
  {"externalId":"5186451114","name":"แบตเตอรี่จักรยานไฟฟ้า 48V วิ่งไกล 50กิโลได้จริง  LiFePO4 48V 15AH แบตเตอรี่สกู๊ตเตอร์ไฟฟ้า แบตเตอรี่รถสามล้อไฟฟ้า","price":"4800","description":"แบตเตอรี่จักรยานไฟฟ้า TAICO 48V LiFePO4 ความจุ 14.7Ah จ่ายกระแสสูงสุด 30A รองรับมอเตอร์ไม่เกิน 850W ใช้ได้กับจักรยานไฟฟ้า/สกู๊ตเตอร์/รถ 3 ล้อไฟฟ้า ขั้วต่อ 3 แบบ","image":"https://th-live.slatic.net/p/b736c5c55f4a9e6d27aaafe684bb4087.jpg","stock":8},
  {"externalId":"5191053925","name":"✅ รับประกัน1ปี ✅ ที่ชาร์จถ่าน Vapcell L2 สำหรับถ่าน Li-ion / Ni-MH / Ni-CD ขนาด AA / AAA / 18650 / 18350 / 21700 / 26650 ของแท้100%","price":"195","description":"Vapcell L2 ชาร์จ Li-ion/Ni-MH/Ni-CD รองรับ AA/AAA/18650/18350/21700/26650 (3.7V/1.2V) ชาร์จ 1A×2 ช่อง ตัดอัตโนมัติเมื่อเต็ม ป้องกันชาร์จเกิน/ความร้อน/ลัดวงจร/แร","image":"https://th-live.slatic.net/p/5bd2fec11be818dcc574c0360a10392f.jpg","stock":173},
  {"externalId":"5436558361","name":"แบตเตอรี่สามล้อไฟฟ้า  จักรยานไฟฟ้า60V  15AH LiFePO4  BMS 50แอมป์ ลิเที่ยมฟอสเฟส ปลอดภัยไม่ติดไฟ","price":"5300","description":"แบตเตอรี่ exzellent LiFePO4 60V 15Ah ชาร์จ 73V, ชาร์จเร็ว 5A ใช้แทนแบตตะกั่ว 12V 20Ah ×5 ก้อน ขั้วต่อแบบเกลียว แถมสายต่อ 3 ทาง รองรับจักรยานไฟฟ้า/รถ 3 ล้อไฟฟ้า ","image":"https://th-live.slatic.net/p/a1ce1bbdba81cf5edb5e8f720abbfcf5.jpg","stock":42},
  {"externalId":"5139253189","name":"วงจร BMS 12S (36V) 30A สำหรับแบตเตอรี่ Lifepo4 3.2V","price":"365","description":"BMS 12S 36V 30A, LiFePO4, รุ่น XR-12S-30A, ขนาด 77×56×10 มม., Continuous current 20A/30A, Charger voltage 45V","image":"https://th-live.slatic.net/p/08d219cbbabbc0a01cfc154d0c42eca8.png","stock":18},
  {"externalId":"5709862351","name":"✅ รับประกัน1ปี ✅ ที่ชาร์จถ่าน Vapcell BL4 ที่ชาร์จถ่านเอนกประสงค์ Li-ion / Lifepo4 / Ni-MH / AA-AAA 1.5V","price":"930","description":"Vapcell BL4 ชาร์จ 3A×1 หรือ 1A×4 รองรับ NiCd/NiMH/Li-ion/LiFePO4/Li-ion 1.5V (AA-AAA) ปรับกระแสได้เอง วัดความต้านทาน ทดสอบความจุ โหมดดิสชาร์จ/ซ่อมแบต/Power Bank","image":"https://th-live.slatic.net/p/8b59b41d72528666ad82769e2c416b14.png","stock":16},
  {"externalId":"5170218164","name":"ถ่านชาร์จ Vapcell G62 LiFePO4 3.2V จ่ายไฟต่อเนื่อง 30A 6200mAh 2ก้อน แบตเตอรี่ 32700 ของใหม่แท้ 100% รับประกัน 1เดือน","price":"295","description":"Vapcell G62 LiFePO4 3.2V 6200mAh ขนาด 32700 (32.1×70.5 มม.) จ่ายไฟต่อเนื่อง 30A","image":"https://th-live.slatic.net/p/929316efee33debba0b224b2e83d9e97.jpg","stock":95},
  {"externalId":"5114630908","name":"วงจร BMS 7S(24V) 20A สำหรับแบตเตอรี่ li-ion / NMC3.7V","price":"374","description":"BMS 7S (24V) 20A สำหรับ Li-ion NMC/ไตรภาค\n- ป้องกันชาร์จเกิน: 4.25V±0.04V, ตัดที่ 4.1V±0.05V\n- ป้องกันคายประจุเกิน: 2.8V±0.08V, คืนที่ 3V±0.1V\n- ป้องกันลัดวงจร:","image":"https://th-live.slatic.net/p/3db5a2b16cbfbd0f5786a3e1cbfadb5d.png","stock":12},
  {"externalId":"4833298106","name":"✅ รุ่นใหม่ ✅ ถ่านชาร์จ LiFePO4 3.2V 6000mAh ราคา 1 ก้อน แบตเตอรี่ 32700 ของใหม่แท้ 100%","price":"98","description":"LiFePO4 32700 Vapcell 3.2V 6000mAh | ต่ำสุด 2.5V | ชาร์จสูงสุด 1C | จ่ายไฟต่อเนื่อง 5A | จ่ายไฟสูงสุด 8A (5วิ) | ความต้านทาน <30mΩ | อายุ 1,000 รอบ | 68g | 70×3","image":"https://th-live.slatic.net/p/7d322f03154bf2d1319d283b8f0251e2.jpg","stock":323},
  {"externalId":"5242722508","name":"แบตเตอรี่จักรยานไฟฟ้า48V สำหรับรถดัดแปลง BMS แรง50A  LiFePO4 48V 15AH แบตเตอรี่สกู๊ตเตอร์ไฟฟ้า แบตเตอรี่รถสามล้อไฟฟ้า","price":"5200","description":"TAICO 48V 14.8Ah LiFePO4 จักรยาน/สามล้อไฟฟ้า BMS 50A รองรับมอเตอร์ 1000-1500W แรงดันชาร์จ 58.4V ชาร์จเจอร์ 5A ระยะวิ่ง ~50 กม./ชาร์จ ขั้วต่อ 3 ทาง พร้อมสายเปลือ","image":"https://th-live.slatic.net/p/d00af55c3c0e43615623c15b3cdaaffa.jpg","stock":20},
  {"externalId":"5170060825","name":"ถ่านชาร์จ Vapcell G62 LiFePO4 3.2V จ่ายไฟต่อเนื่อง 30A 6200mAh แบตเตอรี่ 32700 ของใหม่แท้ 100% รับประกัน 1เดือน","price":"149","description":"Vapcell G62 LiFePO4 3.2V 6200mAh ขนาด 32700 (32.1×70.5มม) จ่ายไฟต่อเนื่อง 30A","image":"https://th-live.slatic.net/p/4c02eb4158500ad063515608c4b3f959.jpg","stock":79},
  {"externalId":"5164370145","name":"✅ แถมรางยึดแบต ✅ แบตเตอรี่ 32140 แบบมีเกลียว LifePO4 ความจุ 15Ah จ่ายกระแสสูง 5C ของใหม่แท้ 100% ความจุเต็ม","price":"676","description":"LiFePO4 ขนาด 32140 (มีเกลียว) 3.2V 15Ah, ชาร์จเต็ม 3.6V, ต่ำสุด 2.5V, อัตราจ่าย 5C, ชาร์จสูงสุด 15A เหมาะทำแพ็คแบตจักรยานไฟฟ้า/ไฟถนน/ชุดนอนนา บัดกรีสายไฟได้","image":"https://th-live.slatic.net/p/57d631ce763539efaef67ffaa85c452f.jpg","stock":774},
  {"externalId":"4908860836","name":"✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-D4XL เครื่องชาร์จถ่าน ราง 8 ช่อง สำหรับ ถ่าน18650 ถ่านAA ถ่านAAA Size C / D / Ni-MH / Li-ion / LiFePo4 / 9V คุณภาพสูง","price":"680","description":"Liitokala Lii-D4XL ชาร์จ 4 ช่องอิสระ รองรับ Li-ion 3.7V/3.8V, LiFePO4 3.2V, NiMH/NiCd 1.2V ไซส์ 21700/18650/26650/16340/14500/AA/AAA/SC/D/C จอ LED แสดง %, ชนิดแ","image":"https://th-live.slatic.net/p/040f5b251211ad37b81bdc5ecd6c3323.jpg","stock":37},
  {"externalId":"5333378899","name":"BMS 16S 50A ระบบ 48V สำหรับ Lifepo4 3.2V BMS แบตเตอรี่จักรยานไฟฟ้า สกุตเตอร์ไฟฟ้า สามล้อไฟฟ้า","price":"590","description":"BMS 16S 48V LiFePO4 | ชาร์จเต็ม 58.4V | จ่ายต่อเนื่อง 50A | จ่ายสูงสุด 175A | ชาร์จสูงสุด 50A | Balance 36mA | ตัดอุณหภูมิ 55°C | ความเสียหายจากต่อผิดนอกประกัน","image":"https://sg-test-11.slatic.net/p/33b7c9aae776d5ec71bca752f091049b.jpg","stock":10},
  {"externalId":"4825101614","name":"[ รุ่นใหม่ ] ถ่านชาร์จกำลังสูง Lishen ขนาด18650 3250mah ความจุเต็ม สำหรับงานโหลดหนักๆ แพคสว่านไฟฟ้า ถ่านชาร์จ Li-ion 3.7V แท้ 100%","price":"98","description":"LISHEN LR1865HB Li-Ion 3.6–4.2V 3400mAh ชาร์จสูงสุด 1.5A จ่ายไฟต่อเนื่อง 3A / สูงสุด 5A (5วิ) ความต้านทาน <30mΩ อายุ 1,000 รอบ น้ำหนัก 48g ขนาด 65×18.5มม.","image":"https://th-live.slatic.net/p/0b36c0883cd24ce35c8db1c9d2635a08.jpg","stock":189},
  {"externalId":"5436269246","name":"แบตเตอรี่จักรยานไฟฟ้า36V แอมป์เต็ม LiFePO4 36V 15AH แบตเตอรี่36V","price":"3790","description":"แบตเตอรี่จักรยานไฟฟ้า Exzellent 32V LiFePO4 ความจุ 14.8Ah ใช้แทนแบตตะกั่ว 12V 3 ลูก (36V) วางได้ทุกแนว ขั้วทั่วไป ติดตั้งง่าย","image":"https://th-live.slatic.net/p/c3f713aaa2ba1e2f0db5b8a5a68d51a9.jpg","stock":9},
  {"externalId":"4875510305","name":"BMS 13S  Li-ion / NMC 3.7V  30A วงจรป้องกันแบตเตอรี่ วงจรแบตเตอรี่ จักรยานไฟฟ้า48V","price":"290","description":"BMS 13S 30A สำหรับแบตเตอรี่ Li-ion / NMC 3.7V สำหรับแบตเตอรี่ระบบ 48V เช่นระบบแบตเตอรี่จักรยานไฟฟ้า","image":"https://th-live.slatic.net/p/8ca46800f84d86e1d3051d2e7be51703.jpg","stock":11},
  {"externalId":"5211344086","name":"✅ สั่งประกอบ ✅ แบตเตอรี่ 32140 LifePO4 ความจุ 15Ah จ่ายกระแสสูง 5C สั่งแพ๊กตามจำนวนที่ลูกค้าต้องการ","price":"2100","description":"แบตเตอรี่ LiFePO4 3.2V 15Ah ต่อก้อน ผ่านคัด IR, ชาร์จ+บาลานส์ด้วยระบบคอมพิวเตอร์ มี มอก. มีเอกสารทดสอบ ประกอบตามสั่ง กำหนดจำนวนเซลล์และรูปแบบได้","image":"https://th-live.slatic.net/p/2924815ba7b9fd19db29118b62144cf2.jpg","stock":187},
  {"externalId":"5334502841","name":"BMS พร้อม Active banance 1.2A ในตัว สำหรับแบตเตอรี่ Lifepo4 3.2V ขนาด 4S 6S 8S","price":"480","description":"BMS Active Balance 1.2A สำหรับ LiFePO4 3.2V\n- 4S/12V: แรงดันสูงสุด 14.4V, ต่อเนื่อง 50A, สูงสุด 90A\n- 6S/21V: แรงดันสูงสุด 21.9V, ต่อเนื่อง 25A\n- 8S/24V: แรงดัน","image":"https://sg-test-11.slatic.net/p/026e73f845476661da162dd462961ae0.jpg","stock":31},
  {"externalId":"5688776263","name":"แบตเตอรี่ มอเตอร์ไซค์ไฟฟ้า รถกอล์ฟไฟฟ้า LiFePO4 48V 30Ah  อายุการใช้งานยาวนาน ปลอดภัยไม่ติดไฟ","price":"8700","description":"แบตเตอรี่ LiFePO4 รองรับ 3,000–5,000 รอบชาร์จ ใช้กับมอเตอร์ไซค์ไฟฟ้า, รถกอล์ฟไฟฟ้า, รถไฟฟ้า, UPS และระบบสำรองไฟ","image":"https://th-live.slatic.net/p/fc168474a07048d818518bc94123f324.png","stock":20},
  {"externalId":"5243010397","name":"แบตเตอรี่จักรยานไฟฟ้า48V แอมป์เต็ม LiFePO4 48V 15AH แบตเตอรี่48V แบตเตอรี่รถสามล้อไฟฟ้า","price":"4700","description":"แบตเตอรี่จักรยาน/สามล้อไฟฟ้า Exzellent 48V LiFePO4 ความจุ 14.8Ah วิ่งได้ ~50 กม./ชาร์จ ต่อขนานได้ รองรับทุกแนววาง ใช้กับรถ 48V","image":"https://th-live.slatic.net/p/69ad637c872421ea9f9532faae79b9e8.jpg","stock":47},
  {"externalId":"5689013110","name":"แบตเตอรี่ สำหรับ จักรยานไฟฟ้า รถกอล์ฟไฟฟ้า LiFePO4 72V 30Ah  ปลอดภัยไม่ติดไฟ","price":"13500","description":"LiFePO4 รองรับชาร์จ 2,000–3,000 รอบ ใช้กับจักรยานไฟฟ้า/สกู๊ตเตอร์ไฟฟ้า/โซลาร์เซลล์","image":"https://th-live.slatic.net/p/458f38202ca9ac256d6861348ad214bd.png","stock":9},
  {"externalId":"5688666739","name":"แบตเตอรี่ มอเตอร์ไซค์ไฟฟ้า รถกอล์ฟไฟฟ้า LiFePO4 60V 15Ah  อายุการใช้งานยาวนาน ปลอดภัยไม่ติดไฟ","price":"5500","description":"แบตเตอรี่ LiFePO4 รองรับ 3,000–5,000 รอบชาร์จ ใช้กับมอเตอร์ไซค์ไฟฟ้า, รถกอล์ฟไฟฟ้า, รถ EV, UPS และระบบสำรองไฟ","image":"https://th-live.slatic.net/p/6e05beb31a1920b5899e48ce1ca4b198.png","stock":50},
  {"externalId":"5101149549","name":"✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-S4 เครื่องชาร์จถ่าน ราง 4 ช่อง สำหรับ ถ่าน18650 ถ่านAA ถ่านAAA Ni-MH / Li-ion / LiFePo4 / 9V คุณภาพสูง ของแท้ 100% ประกัน1ปีเต็ม","price":"390","description":"LiitoKala Lii-S4 เครื่องชาร์จ สีดำ ขนาด 118×100×30 มม. น้ำหนัก 136.4 กรัม อินพุต USB Type-C DC 5V 2A เอาต์พุต Li-Ion 4.20V / IMR 4.35V / LiFePO4 3.65V / NiMH·Ni","image":"https://th-live.slatic.net/p/d5363209314bc9a99f2d671963960794.png","stock":1},
  {"externalId":"5688936051","name":"แบตเตอรี่ TAICO สำหรับ จักรยานไฟฟ้า สกู๊ตเตอร์ไฟฟ้า LiFePO4 60V 20Ah  ปลอดภัยไม่ติดไฟ","price":"8600","description":"LiFePO4 รองรับชาร์จ 2,000–3,000 รอบ ใช้กับรถจักรยานไฟฟ้า สกู๊ตเตอร์ไฟฟ้า ระบบโซลาร์","image":"https://th-live.slatic.net/p/2f400b0ed5b2385b1f65346820d4f073.png","stock":17},
  {"externalId":"5436469344","name":"แบตเตอรี่สามล้อไฟฟ้า  จักรยานไฟฟ้า48V  15AH LiFePO4  BMS 50แอมป์ ลิเที่ยมฟอสเฟส ปลอดภัยไม่ติดไฟ","price":"5400","description":"แบตLiFePO4 48V 14.8Ah / BMS 50A / รองรับมอเตอร์ 1000W-1500W / ชาร์จ 58.4V / ที่ชาร์จเร็ว 5A / ขั้วต่อ 3 ทาง (รถ3ล้า) พร้อมสายเปลือยสำหรับรุ่นอื่น / เข้ากันได้กั","image":"https://th-live.slatic.net/p/04f3647a13334d8125df6c991cea4688.jpg","stock":47},
  {"externalId":"5745163266","name":"✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-CH4 ชาร์จลิเที่ยม 1.5V  ถ่าน18650 ถ่านAA ถ่านAAA Ni-MH / Li-ion","price":"490","description":"Liitokala Lii-CH4 เครื่องชาร์จ Li-ion/LiFePO4 Input: USB 5V/2A Output: 1.45V/3.65V/4.25V/4.35V กระแส 500mA/1000mA รองรับ 1.5V/3.7V/3.8V/3.65V/4.25V ไม่มีโหมดวัด","image":"https://th-live.slatic.net/p/08e57055de85f67eb2e6ab721aa21b55.jpg","stock":35},
];
