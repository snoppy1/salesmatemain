// ดัมป์คลังสินค้า+ข้อมูลร้าน (อ่านอย่างเดียว) เป็น JSON สำหรับด่านทดสอบคุณภาพชุดที่ 2
// ใช้: node scripts/zz-dump-catalog-snapshot.mjs <path-ปลายทาง.json>
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

const out = process.argv[2];
if (!out) throw new Error("ระบุ path ไฟล์ปลายทาง");

const p = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const shopLike = process.argv[3] || "ร้านของ Nathapat%";
const shop = (
  await p.query("SELECT id, name, voice, ai_memory FROM shops WHERE name LIKE $1 LIMIT 1", [shopLike])
).rows[0];
if (!shop) throw new Error("ไม่พบร้าน: " + shopLike);

const products = (
  await p.query(
    `SELECT name, COALESCE(description,'') AS description, COALESCE(price,'') AS price,
            enabled, stock
     FROM products WHERE shop_id = $1 ORDER BY sort_order ASC`,
    [shop.id],
  )
).rows.map((r) => ({
  name: r.name,
  description: r.description,
  price: r.price,
  enabled: r.enabled,
  stock: r.stock == null ? undefined : Number(r.stock),
}));

const promos = (
  await p.query(
    `SELECT title, COALESCE(code,'') AS code, COALESCE(product_scope,'') AS product_scope,
            min_spend, COALESCE(conditions_text,'') AS conditions_text, starts_at, ends_at
     FROM promotions WHERE shop_id = $1 ORDER BY synced_at DESC, id`,
    [shop.id],
  ).catch(() => ({ rows: [] }))
).rows;

await p.end();

const inStock = products.filter((x) => x.enabled !== false && typeof x.stock === "number" && x.stock > 0);
const soldOut = products.filter((x) => x.enabled !== false && typeof x.stock === "number" && x.stock <= 0);
const noStock = products.filter((x) => x.enabled !== false && typeof x.stock !== "number");

writeFileSync(
  out,
  JSON.stringify(
    { shopName: shop.name, shopVoice: shop.voice ?? "", shopMemory: shop.ai_memory ?? "", products, promotions: promos },
    null,
    1,
  ),
);

console.log(`ร้าน: ${shop.name}`);
console.log(`สินค้า ${products.length} | มีของ ${inStock.length} | หมด ${soldOut.length} | ไม่รู้สต็อก ${noStock.length} | โปร ${promos.length}`);
console.log(`\nตัวอย่างของที่หมด (5):`);
for (const x of soldOut.slice(0, 5)) console.log(` - [${x.stock}] ${x.name.slice(0, 90)}`);
console.log(`\nตัวอย่างของที่มี (5):`);
for (const x of inStock.slice(0, 5)) console.log(` - [${x.stock}] ${x.name.slice(0, 90)} | ${x.price} บาท`);
console.log(`\nบันทึกที่: ${out}`);
