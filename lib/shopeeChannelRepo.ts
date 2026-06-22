import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

export type ShopeeChannelRow = {
  id: string;
  shop_id: string;
  account_id: string;
  access_token: string;
  account_name: string;
};

const COLS = "id, shop_id, account_id, access_token, account_name";

/** บันทึก/แทนที่บัญชีแชต Shopee ของร้าน (1 ร้าน 1 บัญชี) */
export async function saveChannel(
  shopId: string,
  c: { accountId: string; accessToken: string; accountName: string },
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO shopee_channels
       (id, shop_id, account_id, access_token, account_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (shop_id) DO UPDATE SET
       account_id   = EXCLUDED.account_id,
       access_token = EXCLUDED.access_token,
       account_name = EXCLUDED.account_name,
       updated_at   = EXCLUDED.updated_at`,
    [newId(), shopId, c.accountId, c.accessToken, c.accountName, now],
  );
}

export async function getChannelByShop(
  shopId: string,
): Promise<ShopeeChannelRow | null> {
  return (
    (await queryOne<ShopeeChannelRow>(
      `SELECT ${COLS} FROM shopee_channels WHERE shop_id = $1`,
      [shopId],
    )) ?? null
  );
}

export async function getChannelByAccountId(
  accountId: string,
): Promise<ShopeeChannelRow | null> {
  return (
    (await queryOne<ShopeeChannelRow>(
      `SELECT ${COLS} FROM shopee_channels WHERE account_id = $1`,
      [accountId],
    )) ?? null
  );
}

export async function deleteChannel(shopId: string): Promise<void> {
  await query("DELETE FROM shopee_channels WHERE shop_id = $1", [shopId]);
}
