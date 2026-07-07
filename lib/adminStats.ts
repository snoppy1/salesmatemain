import "server-only";
import { query } from "./db";
import { costByShopSince, totalCostSince } from "./aiUsageRepo";

/** ประมาณค่า AI: ข้อความลูกค้า 1 ข้อความ ≈ 1 การตอบ ≈ ฿0.5 (ค่า warm เฉลี่ยที่วัดจริง) */
export const THB_PER_CUSTOMER_MSG = 0.5;

/** เวลาที่คนต้องใช้พิมพ์ตอบ 1 ข้อความ (วินาที) — ฐานคิด "เวลาที่ AI ประหยัดให้" (ประมาณการ) */
export const SECONDS_SAVED_PER_AI_MSG = 45;

/** เพดานเวลาตอบที่นับเป็น "response time" — เกินนี้ถือเป็นบทสนทนาใหม่ ไม่ใช่การตอบต่อเนื่อง */
const RESPONSE_CAP_MS = 3600e3; // 1 ชม.

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
  humanMsgs7d: number; // ข้อความที่แอดมินพิมพ์เอง (ไม่ใช่ AI) — ใช้คิด deflection
  deflectionPct: number | null; // % ที่ AI ตอบแทนคน = ai / (ai + human) 7 วัน (null = ยังไม่มีข้อมูล)
  avgResponseSec: number | null; // เวลาเฉลี่ย ลูกค้าทัก → AI ตอบ (วินาที) 7 วัน
  upsellOffered7d: number; // AI เสนอพ่วงกี่ครั้ง
  upsellSold7d: number; // ปิดพ่วงได้จริงกี่ครั้ง
  upsellSoldValue7d: number; // มูลค่าพ่วงที่ปิดได้จริง (บาท)
  afterHoursAi7d: number; // AI ตอบนอกเวลาทำการ (20:00-08:00) กี่ข้อความ
  costTodayTHB: number; // ต้นทุน AI จริงวันนี้ (จาก usage)
  cost7dTHB: number; // ต้นทุน AI จริง 7 วัน
  lazadaToken: "none" | "ok" | "expired"; // สถานะ token Lazada (expired = แชตใหม่ไม่เข้า)
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
  /** ประสิทธิภาพ AI รวมทุกร้าน 7 วัน — ตัวเลขตัดสินใจ (ยังไม่โชว์ร้าน จนกว่าจะพิสูจน์) */
  efficiency: {
    deflectionPct: number | null; // AI ตอบแทนคนกี่ %
    avgResponseSec: number | null; // เวลาตอบเฉลี่ย
    upsellConvPct: number | null; // เสนอพ่วง → ปิดได้ กี่ %
    upsellSoldValue7d: number; // มูลค่าพ่วงปิดได้จริงรวม
    afterHoursAi7d: number; // ตอบนอกเวลาทำการรวม
    timeSavedHours7d: number; // เวลาที่ประหยัดให้ร้าน (ชม.) = aiMsgs × วินาที/ข้อความ
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
    human_7d: number;
    afterhours_ai_7d: number;
    resp_avg_ms: string | null;
    upsell_offered_7d: number;
    upsell_sold_7d: number;
    upsell_sold_value_7d: number;
    lazada_expires_at: string | null;
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
       -- แอดมินพิมพ์เอง (ไม่ใช่ AI) 7 วัน → ใช้คิด deflection
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.sender = 'admin' AND m.ai_generated = false AND m.created_at >= $2) AS human_7d,
       -- AI ตอบนอกเวลาทำการ: ชั่วโมงไทย = ((ms + 7ชม.) / 1ชม.) % 24; กลางวัน = 8-19, นอกเวลา = ที่เหลือ
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.ai_generated = true AND m.created_at >= $2
           AND (((m.created_at + 25200000) / 3600000) % 24) NOT BETWEEN 8 AND 19) AS afterhours_ai_7d,
       -- เวลาตอบเฉลี่ย: สำหรับข้อความ AI แต่ละอัน = เวลาห่างจากข้อความลูกค้าล่าสุดก่อนหน้า (cap 1 ชม.)
       (SELECT avg(sub.dt)::bigint FROM (
          SELECT m.created_at - (
            SELECT max(cm.created_at) FROM messages cm
            WHERE cm.conversation_id = m.conversation_id AND cm.sender = 'customer' AND cm.created_at < m.created_at
          ) AS dt
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.shop_id = s.id AND m.ai_generated = true AND m.created_at >= $2
        ) sub WHERE sub.dt IS NOT NULL AND sub.dt >= 0 AND sub.dt <= ${RESPONSE_CAP_MS}) AS resp_avg_ms,
       (SELECT count(*)::int FROM upsell_events ue WHERE ue.shop_id = s.id AND ue.created_at >= $2) AS upsell_offered_7d,
       (SELECT count(*)::int FROM upsell_events ue WHERE ue.shop_id = s.id AND ue.created_at >= $2 AND ue.sold = true) AS upsell_sold_7d,
       (SELECT COALESCE(sum(ue.sold_value), 0)::int FROM upsell_events ue WHERE ue.shop_id = s.id AND ue.created_at >= $2 AND ue.sold = true) AS upsell_sold_value_7d,
       (SELECT lc.expires_at FROM lazada_channels lc WHERE lc.shop_id = s.id LIMIT 1) AS lazada_expires_at,
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

  const shops: ShopOverviewRow[] = rows.map((r) => {
    const ai7d = r.ai_7d;
    const human7d = r.human_7d;
    const answered = ai7d + human7d;
    const respMs = r.resp_avg_ms != null ? Number(r.resp_avg_ms) : null;
    return {
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
      aiMsgs7d: ai7d,
      humanMsgs7d: human7d,
      deflectionPct: answered > 0 ? Math.round((ai7d / answered) * 100) : null,
      avgResponseSec: respMs != null ? Math.round(respMs / 1000) : null,
      upsellOffered7d: r.upsell_offered_7d,
      upsellSold7d: r.upsell_sold_7d,
      upsellSoldValue7d: r.upsell_sold_value_7d,
      afterHoursAi7d: r.afterhours_ai_7d,
      costTodayTHB: costTodayMap.get(r.id) ?? 0,
      cost7dTHB: cost7dMap.get(r.id) ?? 0,
      // token หมดอายุ = Lazada หยุด push แชตใหม่ (expires_at null = ไม่ทราบอายุ ถือว่ายังใช้ได้)
      lazadaToken: !r.has_lazada
        ? "none"
        : r.lazada_expires_at != null && Number(r.lazada_expires_at) < Date.now()
          ? "expired"
          : "ok",
      lastActivityAt: r.last_activity != null ? Number(r.last_activity) : null,
    };
  });

  const custMsgsToday = shops.reduce((a, s) => a + s.custMsgsToday, 0);
  const aiMsgsToday = shops.reduce((a, s) => a + s.aiMsgsToday, 0);

  // รวมประสิทธิภาพทุกร้าน (7 วัน)
  const sumAi7d = shops.reduce((a, s) => a + s.aiMsgs7d, 0);
  const sumHuman7d = shops.reduce((a, s) => a + s.humanMsgs7d, 0);
  const sumAnswered = sumAi7d + sumHuman7d;
  const sumOffered = shops.reduce((a, s) => a + s.upsellOffered7d, 0);
  const sumSold = shops.reduce((a, s) => a + s.upsellSold7d, 0);
  // เวลาตอบเฉลี่ยรวม = ถ่วงน้ำหนักด้วยจำนวนข้อความ AI ของแต่ละร้าน
  let respWeighted = 0;
  let respWeight = 0;
  for (const s of shops) {
    if (s.avgResponseSec != null && s.aiMsgs7d > 0) {
      respWeighted += s.avgResponseSec * s.aiMsgs7d;
      respWeight += s.aiMsgs7d;
    }
  }

  return {
    cards: {
      totalShops: shops.length,
      activeToday: shops.filter((s) => s.custMsgsToday > 0).length,
      custMsgsToday,
      aiMsgsToday,
      costTodayTHB: costTodayTotal,
    },
    efficiency: {
      deflectionPct: sumAnswered > 0 ? Math.round((sumAi7d / sumAnswered) * 100) : null,
      avgResponseSec: respWeight > 0 ? Math.round(respWeighted / respWeight) : null,
      upsellConvPct: sumOffered > 0 ? Math.round((sumSold / sumOffered) * 100) : null,
      upsellSoldValue7d: shops.reduce((a, s) => a + s.upsellSoldValue7d, 0),
      afterHoursAi7d: shops.reduce((a, s) => a + s.afterHoursAi7d, 0),
      timeSavedHours7d: Math.round((sumAi7d * SECONDS_SAVED_PER_AI_MSG) / 3600),
    },
    shops,
  };
}
