import "server-only";
import { createHmac } from "node:crypto";
import { isLazadaConfigured } from "./marketplace";

export type OrderItem = { name: string; quantity: number };
export type OrderSummary = {
  orderId: string;
  status: string;
  statusText: string;
  createdAt: number | null;
  items: OrderItem[];
};
export type ShipmentTrace = {
  orderId: string;
  status: string;
  statusText: string;
  trackingNumber: string;
  carrier: string;
  lastUpdate: number | null;
};

const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";
// Lazada Open Platform — กลุ่ม Order Information (Active): GetOrder + GetOrderItems
// (Lazada ไม่มี endpoint trace พัสดุแยก — เลขพัสดุ/ขนส่ง/สถานะ มาจาก order items)
const ORDER_PATH = "/order/get";
const ITEMS_PATH = "/order/items/get";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Lazada created_at/updated_at อาจเป็น epoch ms หรือ string วันที่ ("2018-05-08 18:00:00 +07:00")
function parseLazadaDate(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// Lazada คืน order item 1 แถวต่อ 1 ชิ้น → รวมตามชื่อ + นับจำนวน
function aggregateItems(arr: unknown[]): OrderItem[] {
  const map = new Map<string, number>();
  for (const it of arr) {
    const x = (it ?? {}) as Record<string, unknown>;
    const name = String(x.name ?? "").trim();
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + (Number(x.quantity ?? 1) || 1));
  }
  return [...map].map(([name, quantity]) => ({ name, quantity }));
}

const STATUS_TEXT: Record<string, string> = {
  paid: "ชำระเงินแล้ว กำลังเตรียมจัดส่ง",
  packing: "ร้านกำลังแพ็คสินค้า",
  shipped: "จัดส่งแล้ว กำลังนำส่ง",
  delivered: "จัดส่งสำเร็จแล้ว",
  cancelled: "ออเดอร์ถูกยกเลิก",
};

export function parseOrder(raw: Record<string, unknown>): OrderSummary | null {
  const id = raw.order_id;
  if (id == null || String(id) === "") return null;
  const statuses = (raw.statuses as unknown[]) ?? [];
  const status = String(Array.isArray(statuses) ? statuses[0] ?? "" : raw.status ?? "").trim();
  const itemsRaw = (raw.items as unknown[]) ?? [];
  const items: OrderItem[] = Array.isArray(itemsRaw)
    ? itemsRaw.map((it) => {
        const x = (it ?? {}) as Record<string, unknown>;
        return { name: String(x.name ?? "").trim(), quantity: Number(x.quantity ?? 1) || 1 };
      })
    : [];
  return {
    orderId: String(id),
    status,
    statusText: STATUS_TEXT[status] ?? status ?? "",
    createdAt: parseLazadaDate(raw.created_at),
    items,
  };
}

export function parseTrace(raw: Record<string, unknown>): ShipmentTrace | null {
  const id = raw.order_id;
  if (id == null || String(id) === "") return null;
  return {
    orderId: String(id),
    status: String(raw.status ?? "").trim(),
    statusText: String(raw.detail ?? raw.status_text ?? "").trim(),
    trackingNumber: String(raw.tracking_number ?? "").trim(),
    carrier: String(raw.carrier ?? "").trim(),
    lastUpdate: num(raw.updated_at),
  };
}

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const base = path + sorted.map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

async function signedGet(
  path: string,
  accessToken: string,
  extra: Record<string, string>,
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
  const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`, { method: "GET" });
  return (await res.json()) as Record<string, unknown>;
}

function isMock(token: string): boolean {
  return !isLazadaConfigured() || token.startsWith("mock");
}

function mockOrder(orderId: string): OrderSummary {
  return {
    orderId,
    status: "shipped",
    statusText: STATUS_TEXT.shipped,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    items: [{ name: "หูฟังบลูทูธ TWS", quantity: 1 }],
  };
}

export async function getOrder(accessToken: string, orderId: string): Promise<OrderSummary | null> {
  if (orderId.toUpperCase().includes("NOTFOUND")) return null;
  if (isMock(accessToken)) return mockOrder(orderId);
  try {
    const data = await signedGet(ORDER_PATH, accessToken, { order_id: orderId });
    if (String(data.code ?? "0") !== "0") return null; // Lazada code != "0" = error
    const parsed = parseOrder((data.data ?? {}) as Record<string, unknown>);
    if (!parsed) return null;
    const itemsData = await signedGet(ITEMS_PATH, accessToken, { order_id: orderId });
    parsed.items = aggregateItems((itemsData.data as unknown[]) ?? []);
    return parsed;
  } catch {
    return null;
  }
}

export async function traceShipment(accessToken: string, orderId: string): Promise<ShipmentTrace | null> {
  if (orderId.toUpperCase().includes("NOTFOUND")) return null;
  if (isMock(accessToken)) {
    return {
      orderId,
      status: "in_transit",
      statusText: "พัสดุถึงศูนย์คัดแยกบางนา กำลังนำจ่าย",
      trackingNumber: "TH" + orderId,
      carrier: "Flash Express",
      lastUpdate: Date.now() - 1000 * 60 * 60 * 3,
    };
  }
  try {
    // เลขพัสดุ/ขนส่ง/สถานะ มาจาก order items (Lazada ไม่มี trace endpoint แยก)
    const itemsData = await signedGet(ITEMS_PATH, accessToken, { order_id: orderId });
    if (String(itemsData.code ?? "0") !== "0") return null;
    const items = (itemsData.data as Record<string, unknown>[]) ?? [];
    if (!items.length) return null;
    const first = items[0] ?? {};
    const status = String(first.status ?? "").trim();
    return {
      orderId,
      status,
      statusText: STATUS_TEXT[status] ?? status,
      trackingNumber: String(first.tracking_code ?? "").trim(),
      carrier: String(first.shipment_provider ?? "").trim(),
      lastUpdate: parseLazadaDate(first.updated_at),
    };
  } catch {
    return null;
  }
}

export async function getOrdersByBuyer(accessToken: string, buyerId: string): Promise<OrderSummary[]> {
  if (isMock(accessToken)) return [mockOrder("MOCK-" + buyerId.slice(0, 6))];
  // Lazada GetOrders กรองได้แค่ตามวันที่/สถานะ ไม่มีตัวกรองตาม buyer
  // → คืน [] แล้วให้ AI ขอเลขออเดอร์จากลูกค้าแทน (ใช้ได้จริงทุกช่องทาง)
  return [];
}
