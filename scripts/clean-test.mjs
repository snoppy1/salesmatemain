// ลบร้านทดสอบที่ username ขึ้นต้นด้วย mkt_ หรือ neon_test (cascade ลบ admin/rules/products/connections)
import { readFileSync } from "node:fs";
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

const res = await p.query(
  `DELETE FROM shops
   WHERE id IN (
     SELECT shop_id FROM admins
     WHERE username LIKE 'mkt_%' OR username LIKE 'mkt-%' OR username LIKE 'neon_test%'
   )
   RETURNING name`,
);

console.log(`ลบร้านทดสอบ ${res.rowCount} ร้าน:`);
for (const r of res.rows) console.log(`  - ${r.name}`);

const left = await p.query("SELECT count(*)::int AS c FROM shops");
console.log(`เหลือร้านใน DB ทั้งหมด: ${left.rows[0].c}`);
await p.end();
