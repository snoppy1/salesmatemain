import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";
import { refreshTokens as refreshLazada, type TokenSet } from "./marketplace";
import { refreshTokens as refreshShopee } from "./shopee";
import { refreshTokens as refreshTiktok } from "./tiktok";
import type { ConnectionStatus } from "./types";

/** เลือกฟังก์ชัน refresh token ตาม marketplace */
function refresherFor(platform: string) {
  if (platform === "shopee") return refreshShopee;
  if (platform === "tiktok") return refreshTiktok;
  return refreshLazada;
}

type ConnRow = {
  id: string;
  shop_id: string;
  platform: string;
  seller_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  is_mock: boolean;
};

async function getRow(shopId: string, platform: string): Promise<ConnRow | undefined> {
  return queryOne<ConnRow>(
    "SELECT * FROM connections WHERE shop_id = $1 AND platform = $2",
    [shopId, platform],
  );
}

/** ร้านที่เชื่อม marketplace จริง (ไม่นับ mock — กัน sync ไปกวนข้อมูลทดลอง zz-*)
 *  ใช้โดย cron sync สินค้า/สต๊อกอัตโนมัติ */
export async function listConnectedShopIds(): Promise<string[]> {
  const rows = await query<{ shop_id: string }>(
    "SELECT DISTINCT shop_id FROM connections WHERE is_mock = false",
  );
  return rows.map((r) => r.shop_id);
}

export async function getStatus(
  shopId: string,
  platform: string,
): Promise<ConnectionStatus> {
  const row = await getRow(shopId, platform);
  if (!row) return { connected: false, platform };
  return {
    connected: true,
    platform,
    sellerId: row.seller_id,
    expiresAt: Number(row.expires_at),
    mock: row.is_mock,
  };
}

/** บันทึก/แทนที่การเชื่อมต่อ (1 ร้าน 1 platform) */
export async function saveConnection(
  shopId: string,
  platform: string,
  t: TokenSet,
): Promise<void> {
  await query(
    `INSERT INTO connections
       (id, shop_id, platform, seller_id, access_token, refresh_token, expires_at, is_mock, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (shop_id, platform) DO UPDATE SET
       seller_id = EXCLUDED.seller_id,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       is_mock = EXCLUDED.is_mock`,
    [
      newId(),
      shopId,
      platform,
      t.sellerId,
      t.accessToken,
      t.refreshToken,
      t.expiresAt,
      t.mock,
      Date.now(),
    ],
  );
}

export async function deleteConnection(shopId: string, platform: string): Promise<void> {
  await query("DELETE FROM connections WHERE shop_id = $1 AND platform = $2", [
    shopId,
    platform,
  ]);
}

/**
 * คืน access token ที่ใช้ได้ — ถ้าใกล้หมดอายุ (เหลือ < 30 นาที) จะ refresh + บันทึกใหม่
 * คืน null ถ้ายังไม่เชื่อมต่อ
 *
 * หมายเหตุ: ใช้ buffer แค่ 30 นาที (ไม่ใช่ 1 วัน) เพราะ token ของ Shopee อายุสั้น (~4 ชม.)
 * ถ้า buffer กว้างกว่าอายุ token จะ refresh ทุกครั้งที่เรียก → refresh token หมุนรัวจนโดน rate-limit
 */
export async function getValidAccessToken(
  shopId: string,
  platform: string,
): Promise<string | null> {
  const row = await getRow(shopId, platform);
  if (!row) return null;

  const expiresAt = Number(row.expires_at);
  const nearExpiry = expiresAt - Date.now() < 1000 * 60 * 30; // < 30 นาที
  if (!nearExpiry) return row.access_token;

  try {
    const refreshed = await refresherFor(platform)(row.refresh_token, row.seller_id);
    await saveConnection(shopId, platform, refreshed);
    return refreshed.accessToken;
  } catch {
    // refresh ไม่สำเร็จ (เน็ตหลุด/แพลตฟอร์มล่ม) → ใช้ token เดิมไปก่อน ดีกว่าทำให้พังทั้งระบบ
    return row.access_token;
  }
}
