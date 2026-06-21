// ลบเฉพาะร้านสมมติที่ seed.mjs สร้าง (เจาะจง username)
import { readFileSync } from "node:fs";
import pg from "pg";

const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

const DEMO_USERNAMES = ["suaybeauty", "doihom", "minimoda", "healthypro"];

const p = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ลบที่ shop → cascade ลบ admin + rules (เฉพาะร้านของ username เหล่านี้)
const res = await p.query(
  `DELETE FROM shops
   WHERE id IN (SELECT shop_id FROM admins WHERE username = ANY($1::text[]))
   RETURNING name`,
  [DEMO_USERNAMES],
);

console.log(`ลบร้านสมมติ ${res.rowCount} ร้าน:`);
for (const r of res.rows) console.log(`  - ${r.name}`);

const left = await p.query("SELECT count(*)::int AS c FROM shops");
console.log(`\nเหลือร้านใน DB ทั้งหมด: ${left.rows[0].c}`);
await p.end();
