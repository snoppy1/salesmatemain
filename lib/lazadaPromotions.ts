import "server-only";
import { createHmac } from "node:crypto";
import { isLazadaConfigured } from "./marketplace";
import type { Promotion } from "./types";

const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";
// NOTE: endpoint + สิทธิ์ Promotion ของ Lazada ยังต้องยืนยันใน console ก่อนใช้จริง
// ถ้ายังไม่ได้สิทธิ์ การเรียกจริงจะ parse ไม่เจอ → คืน [] (mock/manual ครอบช่องว่างไว้)
const PROMOTIONS_PATH = "/promotion/get";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** แปลง payload ดิบของ Lazada → Promotion[] (ป้องกันรูปแบบไม่ตรงด้วยค่า default) */
export function parseLazadaPromotions(raw: Record<string, unknown>): Promotion[] {
  const data = (raw.data ?? {}) as Record<string, unknown>;
  const list = (data.promotions as unknown[]) ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const x = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(x.promotion_id ?? ""),
      title: String(x.title ?? "").trim(),
      type: String(x.promotion_type ?? "").trim(),
      conditionsText: String(x.description ?? x.title ?? "").trim(),
      minSpend: num(x.min_order_value),
      productScope: String(x.applicable_products ?? "").trim(),
      code: String(x.voucher_code ?? "").trim(),
      startsAt: num(x.start_time),
      endsAt: num(x.end_time),
      source: "lazada",
    };
  });
}

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const base = path + sorted.map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

/** mock promotions — ครอบเคสที่ต้องเทสต์: ทุกชิ้น / มีโค้ด+ขั้นต่ำ / เจาะสินค้า */
function mockPromotions(): Promotion[] {
  const now = Date.now();
  const day = 1000 * 60 * 60 * 24;
  return [
    {
      id: "MOCK-FREESHIP", title: "ส่งฟรีเมื่อช้อปครบ 300",
      type: "fixed", conditionsText: "ยอดสั่งซื้อรวมตั้งแต่ 300 บาทขึ้นไป ส่งฟรี",
      minSpend: 300, productScope: "", code: "", startsAt: now - day, endsAt: now + day * 14, source: "lazada",
    },
    {
      id: "MOCK-SAVE10", title: "โค้ด SAVE10 ลด 10%",
      type: "code", conditionsText: "กรอกโค้ด SAVE10 ลด 10% ขั้นต่ำ 200 บาท",
      minSpend: 200, productScope: "", code: "SAVE10", startsAt: now - day, endsAt: now + day * 7, source: "lazada",
    },
    {
      id: "MOCK-BUNDLE", title: "หูฟัง + เคส ลดเพิ่ม 50",
      type: "bundle", conditionsText: "ซื้อหูฟังคู่กับเคส ลดเพิ่ม 50 บาท",
      minSpend: null, productScope: "หูฟัง,เคส", code: "", startsAt: now - day, endsAt: now + day * 3, source: "lazada",
    },
  ];
}

/** ดึงโปรจาก Lazada — mock เมื่อยังไม่ตั้งคีย์จริง/โทเค็น mock; ของจริงเมื่อพร้อม */
export async function fetchPromotions(accessToken: string): Promise<Promotion[]> {
  if (!isLazadaConfigured() || accessToken.startsWith("mock")) {
    return mockPromotions();
  }
  const appKey = process.env.LAZADA_APP_KEY as string;
  const appSecret = process.env.LAZADA_APP_SECRET as string;
  const params: Record<string, string> = {
    app_key: appKey,
    access_token: accessToken,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  params.sign = sign(PROMOTIONS_PATH, params, appSecret);
  try {
    const res = await fetch(`${API_BASE}${PROMOTIONS_PATH}?${new URLSearchParams(params)}`, {
      method: "GET",
    });
    const json = (await res.json()) as Record<string, unknown>;
    return parseLazadaPromotions(json);
  } catch {
    return []; // ของจริงล่ม/ไม่มีสิทธิ์ → ไม่มีโปร (ไม่ทำให้ทั้งระบบพัง)
  }
}
