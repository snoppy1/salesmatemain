// ไล่ดูรายการ ai_usage ของ Smarttech ทีละแถว: เวลา/โมเดล/token/ค่า — หาว่าแพงเพราะอะไร (อ่านอย่างเดียว)
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

const cols = (
  await p.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage' ORDER BY ordinal_position`,
  )
).rows.map((r) => r.column_name);
console.log("คอลัมน์:", cols.join(", "), "\n");

const rows = (
  await p.query(
    `SELECT u.*,
            to_char(to_timestamp(u.created_at / 1000) AT TIME ZONE 'Asia/Bangkok', 'DD HH24:MI') AS t
       FROM ai_usage u JOIN shops s ON s.id = u.shop_id
      WHERE s.name = 'Smarttech' AND u.kind IN ('reply', 'prewarm', 'choices', 'order')
      ORDER BY u.created_at`,
  )
).rows;
for (const r of rows) {
  const parts = [`${r.t}`, r.kind.padEnd(7), r.model.replace("claude-", "").padEnd(11)];
  for (const c of ["in_tokens", "out_tokens", "cache_write", "cache_read"]) {
    if (c in r) parts.push(`${c.replace("_tokens", "")}=${r[c]}`);
  }
  parts.push(`฿${Number(r.cost_thb).toFixed(2)}`);
  console.log(" " + parts.join(" | "));
}
await p.end();
