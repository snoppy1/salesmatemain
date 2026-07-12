import "server-only";
import { query, queryOne } from "./db";

/**
 * สถานะการเชื่อมของแต่ละแพลตฟอร์มในร้าน (สำหรับคอนโซลแอดมิน)
 * - connected = เชื่อมแล้ว และ (ถ้ามีวันหมดอายุ) ยังเหลือ ≥ 3 วัน
 * - expiring  = ใกล้หมด (เหลือ < 3 วัน)
 * - expired   = หมดอายุแล้ว/หลุด
 * - none       = ยังไม่เชื่อม (ไม่มี record)
 */
export type ConnStatus = "connected" | "expiring" | "expired" | "none";

export type ChannelConnection = {
  channel: string;
  status: ConnStatus;
  expiresAt: number | null; // epoch ms; null = token ไม่มีวันหมดอายุ (เช่น LINE)
};

const DAY = 86400e3;
const EXPIRING_MS = 3 * DAY; // ใกล้หมด = เหลือน้อยกว่า 3 วัน

/** คำนวณสถานะจาก (มี record ไหม, วันหมดอายุ) */
function statusOf(hasRecord: boolean, expiresAt: number | null): ConnStatus {
  if (!hasRecord) return "none";
  if (expiresAt == null) return "connected"; // ไม่มีวันหมดอายุ (เช่น LINE) → ถือว่าเชื่อมแล้ว
  const left = expiresAt - Date.now();
  if (left < 0) return "expired";
  if (left < EXPIRING_MS) return "expiring";
  return "connected";
}

/**
 * สถานะการเชื่อมทุกแพลตฟอร์มของร้านหนึ่ง (lazada/shopee/line/facebook/tiktok)
 * - lazada: เอา expires_at จาก lazada_channels ก่อน ถ้าไม่มีค่อยดูใน connections(platform='lazada')
 * - shopee: shopee_channels ไม่มี expires_at แต่ connections(platform='shopee') มี → ใช้ถ้ามี
 * - line/facebook/tiktok: channel table ไม่มี expires_at → มี record = เชื่อมแล้ว
 *
 * ทุกคิวรีเป็น lookup ด้วย shop_id (มี index) รันขนานกัน — ไม่ N+1
 */
export async function getShopConnections(shopId: string): Promise<ChannelConnection[]> {
  const [lazadaCh, conns, others] = await Promise.all([
    queryOne<{ expires_at: string | null }>(
      "SELECT expires_at FROM lazada_channels WHERE shop_id = $1",
      [shopId],
    ),
    query<{ platform: string; expires_at: string | null }>(
      "SELECT platform, expires_at FROM connections WHERE shop_id = $1",
      [shopId],
    ),
    query<{ channel: string }>(
      `SELECT 'line' AS channel FROM line_channels WHERE shop_id = $1
       UNION ALL SELECT 'facebook' FROM facebook_channels WHERE shop_id = $1
       UNION ALL SELECT 'tiktok'   FROM tiktok_channels   WHERE shop_id = $1
       UNION ALL SELECT 'shopee'   FROM shopee_channels   WHERE shop_id = $1`,
      [shopId],
    ),
  ]);

  const connByPlatform = new Map(conns.map((c) => [c.platform, c]));
  const otherSet = new Set(others.map((o) => o.channel));

  const result: ChannelConnection[] = [];

  // lazada: มี record ถ้ามีใน lazada_channels หรือ connections; expires_at เอาตัวที่มีค่า
  const lazadaConn = connByPlatform.get("lazada");
  const lazadaHas = Boolean(lazadaCh) || Boolean(lazadaConn);
  const lazadaExp =
    lazadaCh?.expires_at != null
      ? Number(lazadaCh.expires_at)
      : lazadaConn?.expires_at != null
        ? Number(lazadaConn.expires_at)
        : null;
  result.push({ channel: "lazada", status: statusOf(lazadaHas, lazadaExp), expiresAt: lazadaExp });

  // shopee: shopee_channels (ไม่มีวันหมด) + connections(platform='shopee') ที่มี expires_at
  const shopeeConn = connByPlatform.get("shopee");
  const shopeeHas = otherSet.has("shopee") || Boolean(shopeeConn);
  const shopeeExp = shopeeConn?.expires_at != null ? Number(shopeeConn.expires_at) : null;
  result.push({ channel: "shopee", status: statusOf(shopeeHas, shopeeExp), expiresAt: shopeeExp });

  // line/facebook/tiktok: ไม่มีวันหมดอายุในระบบ → มี record = เชื่อมแล้ว
  for (const ch of ["line", "facebook", "tiktok"] as const) {
    result.push({ channel: ch, status: statusOf(otherSet.has(ch), null), expiresAt: null });
  }

  return result;
}
