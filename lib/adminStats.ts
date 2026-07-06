import "server-only";
import { query } from "./db";
import { costByShopSince, totalCostSince } from "./aiUsageRepo";

/** ประมาณค่า AI: ข้อความลูกค้า 1 ข้อความ ≈ 1 การตอบ ≈ ฿0.5 (ค่า warm เฉลี่ยที่วัดจริง) */
export const THB_PER_CUSTOMER_MSG = 0.5;

export type ShopOverviewRow = {
  id: string;
  name: string;
  email: string;
  channels: string[];
  productCount: number;
  conversationCount: number;
  custMsgsToday: number;
  custMsgs7d: number;
  aiMsgsToday: number; // ข้อความที่ AI ตอบเอง (ฐานคิดโควตา subscription ข้อความ/วัน)
  aiMsgs7d: number;
  costTodayTHB: number; // ต้นทุน AI จริงวันนี้ (จาก usage)
  cost7dTHB: number; // ต้นทุน AI จริง 7 วัน
  lastActivityAt: number | null;
};

export type AdminOverview = {
  cards: {
    totalShops: number;
    activeToday: number;
    custMsgsToday: number;
    aiMsgsToday: number;
    costTodayTHB: number; // ต้นทุนจริงวันนี้ (รวมทุกร้าน)
  };
  shops: ShopOverviewRow[];
};

/** เที่ยงคืนของ "วันนี้" ตามเวลาไทย (UTC+7) เป็น epoch ms */
export function bangkokDayStartMs(now = Date.now()): number {
  const BKK = 7 * 3600e3;
  return Math.floor((now + BKK) / 86400e3) * 86400e3 - BKK;
}

/** ภาพรวมทุกร้านสำหรับ console ผู้ดูแลระบบ (คิวรีสด — จำนวนร้านระดับสิบ ไม่ต้อง cache) */
export async function getAdminOverview(): Promise<AdminOverview> {
  const dayStart = bangkokDayStartMs();
  const weekStart = dayStart - 6 * 86400e3; // วันนี้ + ย้อนหลัง 6 วัน = 7 วัน

  const rows = await query<{
    id: string;
    name: string;
    email: string;
    has_line: boolean;
    has_lazada: boolean;
    has_facebook: boolean;
    product_count: number;
    conversation_count: number;
    msgs_today: number;
    msgs_7d: number;
    ai_today: number;
    ai_7d: number;
    last_activity: string | null;
  }>(
    `SELECT s.id, s.name,
       COALESCE((SELECT a.email FROM admins a WHERE a.shop_id = s.id ORDER BY a.created_at ASC LIMIT 1), '') AS email,
       EXISTS (SELECT 1 FROM line_channels x WHERE x.shop_id = s.id)     AS has_line,
       EXISTS (SELECT 1 FROM lazada_channels x WHERE x.shop_id = s.id)   AS has_lazada,
       EXISTS (SELECT 1 FROM facebook_channels x WHERE x.shop_id = s.id) AS has_facebook,
       (SELECT count(*)::int FROM products p WHERE p.shop_id = s.id) AS product_count,
       (SELECT count(*)::int FROM conversations c WHERE c.shop_id = s.id) AS conversation_count,
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.sender = 'customer' AND m.created_at >= $1) AS msgs_today,
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.sender = 'customer' AND m.created_at >= $2) AS msgs_7d,
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.ai_generated = true AND m.created_at >= $1) AS ai_today,
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.ai_generated = true AND m.created_at >= $2) AS ai_7d,
       (SELECT max(c.last_message_at) FROM conversations c WHERE c.shop_id = s.id) AS last_activity
     FROM shops s
     ORDER BY (SELECT max(c.last_message_at) FROM conversations c WHERE c.shop_id = s.id) DESC NULLS LAST`,
    [dayStart, weekStart],
  );

  // ต้นทุนจริงจาก ai_usage (คิวรีรวม/ต่อร้าน) — วิ่งขนานกับข้อมูลร้าน
  const [costTodayMap, cost7dMap, costTodayTotal] = await Promise.all([
    costByShopSince(dayStart),
    costByShopSince(weekStart),
    totalCostSince(dayStart),
  ]);

  const shops: ShopOverviewRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    channels: [
      ...(r.has_line ? ["line"] : []),
      ...(r.has_lazada ? ["lazada"] : []),
      ...(r.has_facebook ? ["facebook"] : []),
    ],
    productCount: r.product_count,
    conversationCount: r.conversation_count,
    custMsgsToday: r.msgs_today,
    custMsgs7d: r.msgs_7d,
    aiMsgsToday: r.ai_today,
    aiMsgs7d: r.ai_7d,
    costTodayTHB: costTodayMap.get(r.id) ?? 0,
    cost7dTHB: cost7dMap.get(r.id) ?? 0,
    lastActivityAt: r.last_activity != null ? Number(r.last_activity) : null,
  }));

  const custMsgsToday = shops.reduce((a, s) => a + s.custMsgsToday, 0);
  const aiMsgsToday = shops.reduce((a, s) => a + s.aiMsgsToday, 0);
  return {
    cards: {
      totalShops: shops.length,
      activeToday: shops.filter((s) => s.custMsgsToday > 0).length,
      custMsgsToday,
      aiMsgsToday,
      costTodayTHB: costTodayTotal,
    },
    shops,
  };
}
