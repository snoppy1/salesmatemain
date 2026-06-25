// สโมกเทสต์ตาราง promotions: สร้างร้านชั่วคราว mkt_promotest → insert/select → ลบทิ้ง (cascade)
// แตะเฉพาะร้าน mkt_promotest เท่านั้น
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

const p = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const shopId = randomUUID();
const now = Date.now();
try {
  // สร้างตารางถ้ายังไม่มี (เหมือน ensureSchema ใน lib/db.ts — idempotent)
  await p.query(`
    CREATE TABLE IF NOT EXISTS promotions (
      id              TEXT PRIMARY KEY,
      shop_id         TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      title           TEXT NOT NULL DEFAULT '',
      type            TEXT NOT NULL DEFAULT '',
      conditions_text TEXT NOT NULL DEFAULT '',
      min_spend       INTEGER,
      product_scope   TEXT NOT NULL DEFAULT '',
      code            TEXT NOT NULL DEFAULT '',
      starts_at       BIGINT,
      ends_at         BIGINT,
      source          TEXT NOT NULL DEFAULT 'lazada',
      synced_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promotions_shop ON promotions(shop_id);
  `);

  await p.query("INSERT INTO shops (id, name, voice, created_at) VALUES ($1,'mkt_promotest','',$2)", [shopId, now]);

  await p.query(
    `INSERT INTO promotions (id, shop_id, title, type, conditions_text, min_spend, product_scope, code, starts_at, ends_at, source, synced_at)
     VALUES ($1,$2,'ส่งฟรี 300','fixed','ยอดถึง 300',300,'','',$3,$4,'lazada',$5)`,
    [randomUUID(), shopId, now - 1000, now + 1000, now],
  );

  const rows = await p.query("SELECT title, min_spend FROM promotions WHERE shop_id = $1", [shopId]);
  if (rows.rowCount === 1 && rows.rows[0].title === "ส่งฟรี 300" && Number(rows.rows[0].min_spend) === 300) {
    console.log("PASS: promotions round-trip ok");
  } else {
    console.log("FAIL: unexpected rows", rows.rows);
    process.exitCode = 1;
  }
} finally {
  await p.query("DELETE FROM shops WHERE id = $1", [shopId]); // cascade ลบ promotions ด้วย
  await p.end();
}
