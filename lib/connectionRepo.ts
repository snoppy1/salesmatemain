import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";
import { refreshTokens, type TokenSet } from "./marketplace";
import type { ConnectionStatus } from "./types";

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
 * คืน access token ที่ใช้ได้ — ถ้าใกล้หมดอายุ (เหลือ < 1 วัน) จะ refresh + บันทึกใหม่
 * คืน null ถ้ายังไม่เชื่อมต่อ
 */
export async function getValidAccessToken(
  shopId: string,
  platform: string,
): Promise<string | null> {
  const row = await getRow(shopId, platform);
  if (!row) return null;

  const expiresAt = Number(row.expires_at);
  const nearExpiry = expiresAt - Date.now() < 1000 * 60 * 60 * 24; // < 1 วัน
  if (!nearExpiry) return row.access_token;

  const refreshed = await refreshTokens(row.refresh_token);
  await saveConnection(shopId, platform, refreshed);
  return refreshed.accessToken;
}
