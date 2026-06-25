// สโมกเทสต์ upsell_events: ร้านชั่วคราว mkt_upselltest → insert 2 แถว → สรุปยอด → ลบทิ้ง (cascade)
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const shopId = randomUUID();
const now = Date.now();
try {
  await p.query(`
    CREATE TABLE IF NOT EXISTS upsell_events (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL, channel TEXT NOT NULL DEFAULT '', product TEXT NOT NULL DEFAULT '',
      est_value INTEGER, created_at BIGINT NOT NULL, sold BOOLEAN NOT NULL DEFAULT false,
      sold_value INTEGER, matched_order_id TEXT );
  `);
  await p.query("INSERT INTO shops (id, name, voice, created_at) VALUES ($1,'mkt_upselltest','',$2)", [shopId, now]);
  for (const v of [120, 80]) {
    await p.query(
      `INSERT INTO upsell_events (id, shop_id, conversation_id, channel, product, est_value, created_at)
       VALUES ($1,$2,'c1','line','เคส',$3,$4)`,
      [randomUUID(), shopId, v, now],
    );
  }
  const r = await p.query(
    "SELECT COUNT(*)::int AS count, COALESCE(SUM(est_value),0)::int AS total FROM upsell_events WHERE shop_id=$1",
    [shopId],
  );
  if (Number(r.rows[0].count) === 2 && Number(r.rows[0].total) === 200) {
    console.log("PASS: upsell summary ok (2 / 200)");
  } else {
    console.log("FAIL", r.rows[0]); process.exitCode = 1;
  }
} finally {
  await p.query("DELETE FROM shops WHERE id = $1", [shopId]);
  await p.end();
}
