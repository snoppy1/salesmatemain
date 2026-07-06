import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

export type LazadaChannelRow = {
  id: string;
  shop_id: string;
  account_id: string;
  access_token: string;
  account_name: string;
  refresh_token: string;
  expires_at: string | null; // epoch ms (bigint) — เวลาหมดอายุ access token
  updated_at: string; // epoch ms — เวลาที่ token ถูกอัปเดตล่าสุด (ต่ออายุสำเร็จ/เชื่อมใหม่)
};

const COLS =
  "id, shop_id, account_id, access_token, account_name, refresh_token, expires_at, updated_at";

/** บันทึก/แทนที่บัญชีแชต Lazada ของร้าน (1 ร้าน 1 บัญชี) */
export async function saveChannel(
  shopId: string,
  c: {
    accountId: string;
    accessToken: string;
    accountName: string;
    refreshToken?: string;
    expiresAt?: number | null;
  },
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO lazada_channels
       (id, shop_id, account_id, access_token, account_name, refresh_token, expires_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (shop_id) DO UPDATE SET
       account_id    = EXCLUDED.account_id,
       access_token  = EXCLUDED.access_token,
       account_name  = EXCLUDED.account_name,
       refresh_token = EXCLUDED.refresh_token,
       expires_at    = EXCLUDED.expires_at,
       updated_at    = EXCLUDED.updated_at`,
    [newId(), shopId, c.accountId, c.accessToken, c.accountName, c.refreshToken ?? "", c.expiresAt ?? null, now],
  );
}

/** อัปเดตเฉพาะ token (หลัง refresh) — คง account เดิม */
export async function updateChannelTokens(
  shopId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number | null,
): Promise<void> {
  await query(
    `UPDATE lazada_channels
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = $4
     WHERE shop_id = $5`,
    [accessToken, refreshToken, expiresAt, Date.now(), shopId],
  );
}

/** ทุก channel แชต Lazada (ใช้ cron ต่ออายุ token) */
export async function listAllChannels(): Promise<LazadaChannelRow[]> {
  return query<LazadaChannelRow>(`SELECT ${COLS} FROM lazada_channels`);
}

export async function getChannelByShop(
  shopId: string,
): Promise<LazadaChannelRow | null> {
  return (
    (await queryOne<LazadaChannelRow>(
      `SELECT ${COLS} FROM lazada_channels WHERE shop_id = $1`,
      [shopId],
    )) ?? null
  );
}

export async function getChannelByAccountId(
  accountId: string,
): Promise<LazadaChannelRow | null> {
  return (
    (await queryOne<LazadaChannelRow>(
      `SELECT ${COLS} FROM lazada_channels WHERE account_id = $1`,
      [accountId],
    )) ?? null
  );
}

export async function deleteChannel(shopId: string): Promise<void> {
  await query("DELETE FROM lazada_channels WHERE shop_id = $1", [shopId]);
}
