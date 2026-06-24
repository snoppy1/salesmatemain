import "server-only";
import { query, queryOne } from "./db";
import type { AutoLevel } from "./types";

const VALID_LEVELS: AutoLevel[] = ["off", "safe", "full"];
export function isValidLevel(v: string): v is AutoLevel {
  return (VALID_LEVELS as string[]).includes(v);
}

export type InboxApp = { channel: string; level: AutoLevel; sortOrder: number };

/** แอปที่ร้านเพิ่มไว้ในกล่องแชต เรียงตามลำดับเพิ่ม */
export async function listInboxApps(shopId: string): Promise<InboxApp[]> {
  const rows = await query<{ channel: string; auto_level: string; sort_order: number }>(
    "SELECT channel, auto_level, sort_order FROM inbox_apps WHERE shop_id = $1 ORDER BY sort_order ASC, channel ASC",
    [shopId],
  );
  return rows.map((r) => ({
    channel: r.channel,
    level: isValidLevel(r.auto_level) ? r.auto_level : "off",
    sortOrder: Number(r.sort_order),
  }));
}

async function nextOrder(shopId: string): Promise<number> {
  const row = await queryOne<{ m: number }>(
    "SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM inbox_apps WHERE shop_id = $1",
    [shopId],
  );
  return (row?.m ?? -1) + 1;
}

/** เพิ่มแอป (default โหมด off) — ซ้ำไม่เป็นไร (idempotent); ใช้ทั้งกดเพิ่มเอง + auto ตอนรับข้อความ */
export async function addInboxApp(shopId: string, channel: string): Promise<void> {
  await query(
    `INSERT INTO inbox_apps (shop_id, channel, auto_level, sort_order)
     VALUES ($1, $2, 'off', $3)
     ON CONFLICT (shop_id, channel) DO NOTHING`,
    [shopId, channel, await nextOrder(shopId)],
  );
}

/** ลบแอปออกจากกล่องแชต (ไม่แตะ conversations/การเชื่อมต่อ) */
export async function removeInboxApp(shopId: string, channel: string): Promise<void> {
  await query("DELETE FROM inbox_apps WHERE shop_id = $1 AND channel = $2", [shopId, channel]);
}

/** โหมด AI ของแอปนั้น — ไม่มีแถว → 'off' */
export async function getChannelLevel(shopId: string, channel: string): Promise<AutoLevel> {
  const row = await queryOne<{ auto_level: string }>(
    "SELECT auto_level FROM inbox_apps WHERE shop_id = $1 AND channel = $2",
    [shopId, channel],
  );
  return row && isValidLevel(row.auto_level) ? row.auto_level : "off";
}

/** ตั้งโหมดของแอป (สร้างแถวถ้ายังไม่มี) */
export async function setChannelLevel(
  shopId: string,
  channel: string,
  level: AutoLevel,
): Promise<void> {
  await query(
    `INSERT INTO inbox_apps (shop_id, channel, auto_level, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (shop_id, channel) DO UPDATE SET auto_level = EXCLUDED.auto_level`,
    [shopId, channel, level, await nextOrder(shopId)],
  );
}
