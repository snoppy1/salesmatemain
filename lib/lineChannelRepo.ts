import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

export type LineChannelRow = {
  id: string;
  shop_id: string;
  channel_secret: string;
  access_token: string;
  bot_user_id: string;
  bot_basic_id: string;
  display_name: string;
};

const COLS =
  "id, shop_id, channel_secret, access_token, bot_user_id, bot_basic_id, display_name";

/** บันทึก/แทนที่ channel ของร้าน (1 ร้าน 1 channel) */
export async function saveChannel(
  shopId: string,
  c: {
    channelSecret: string;
    accessToken: string;
    botUserId: string;
    botBasicId: string;
    displayName: string;
  },
): Promise<void> {
  const now = Date.now();
  // ปลดผูก OA นี้ออกจากร้านอื่นก่อน (1 OA = 1 ร้าน; กัน unique bot_user_id ชนตอนย้ายร้าน)
  await query(
    "DELETE FROM line_channels WHERE bot_user_id = $1 AND shop_id <> $2",
    [c.botUserId, shopId],
  );
  await query(
    `INSERT INTO line_channels
       (id, shop_id, channel_secret, access_token, bot_user_id, bot_basic_id, display_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (shop_id) DO UPDATE SET
       channel_secret = EXCLUDED.channel_secret,
       access_token   = EXCLUDED.access_token,
       bot_user_id    = EXCLUDED.bot_user_id,
       bot_basic_id   = EXCLUDED.bot_basic_id,
       display_name   = EXCLUDED.display_name,
       updated_at     = EXCLUDED.updated_at`,
    [
      newId(),
      shopId,
      c.channelSecret,
      c.accessToken,
      c.botUserId,
      c.botBasicId,
      c.displayName,
      now,
    ],
  );
}

export async function getChannelByShop(
  shopId: string,
): Promise<LineChannelRow | null> {
  return (
    (await queryOne<LineChannelRow>(
      `SELECT ${COLS} FROM line_channels WHERE shop_id = $1`,
      [shopId],
    )) ?? null
  );
}

export async function getChannelByBotUserId(
  botUserId: string,
): Promise<LineChannelRow | null> {
  return (
    (await queryOne<LineChannelRow>(
      `SELECT ${COLS} FROM line_channels WHERE bot_user_id = $1`,
      [botUserId],
    )) ?? null
  );
}

export async function deleteChannel(shopId: string): Promise<void> {
  await query("DELETE FROM line_channels WHERE shop_id = $1", [shopId]);
}
