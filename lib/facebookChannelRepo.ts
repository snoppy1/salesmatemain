import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

export type FacebookChannelRow = {
  id: string;
  shop_id: string;
  page_id: string;
  access_token: string;
  page_name: string;
};

const COLS = "id, shop_id, page_id, access_token, page_name";

/** บันทึก/แทนที่เพจ Facebook ของร้าน (1 ร้าน 1 เพจ) */
export async function saveChannel(
  shopId: string,
  c: { pageId: string; accessToken: string; pageName: string },
): Promise<void> {
  const now = Date.now();
  // เพจนี้เคยผูกกับร้านอื่นไหม → ปลดออกก่อน (1 เพจผูกได้ร้านเดียว; ย้ายมาร้านที่กำลังเชื่อม)
  // กันชนกฎ unique ของ page_id ตอน insert/update
  await query("DELETE FROM facebook_channels WHERE page_id = $1 AND shop_id <> $2", [
    c.pageId,
    shopId,
  ]);
  await query(
    `INSERT INTO facebook_channels
       (id, shop_id, page_id, access_token, page_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (shop_id) DO UPDATE SET
       page_id      = EXCLUDED.page_id,
       access_token = EXCLUDED.access_token,
       page_name    = EXCLUDED.page_name,
       updated_at   = EXCLUDED.updated_at`,
    [newId(), shopId, c.pageId, c.accessToken, c.pageName, now],
  );
}

export async function getChannelByShop(
  shopId: string,
): Promise<FacebookChannelRow | null> {
  return (
    (await queryOne<FacebookChannelRow>(
      `SELECT ${COLS} FROM facebook_channels WHERE shop_id = $1`,
      [shopId],
    )) ?? null
  );
}

export async function getChannelByPageId(
  pageId: string,
): Promise<FacebookChannelRow | null> {
  return (
    (await queryOne<FacebookChannelRow>(
      `SELECT ${COLS} FROM facebook_channels WHERE page_id = $1`,
      [pageId],
    )) ?? null
  );
}

export async function deleteChannel(shopId: string): Promise<void> {
  await query("DELETE FROM facebook_channels WHERE shop_id = $1", [shopId]);
}
