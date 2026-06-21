// สคริปต์ใส่ข้อมูลร้านสมมติลง Postgres (Neon)
// รัน: node scripts/seed.mjs
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import path from "node:path";
import pg from "pg";

// ── อ่าน DATABASE_URL จาก .env.local ──
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ไม่พบ DATABASE_URL ใน .env.local");
  process.exit(1);
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const DEMO_PASSWORD = "demo1234";

// ── ข้อมูลร้านสมมติ ──
const shops = [
  {
    username: "suaybeauty",
    name: "ร้านสวยใส บิวตี้",
    voice: "เป็นกันเอง น่ารัก ลงท้าย 'นะคะ' มีอีโมจิบ้าง ไม่ทางการ",
    rules: [
      { trigger: "ครีมทารอบดวงตา", partner: "เซรั่มบำรุงผิวหน้า", price: "690", reason: "เซรั่มช่วยให้ครีมซึมลึกขึ้น เห็นผลริ้วรอยไวกว่า", promo: "ซื้อคู่ลด 10%" },
      { trigger: "ครีมกันแดด", partner: "คลีนเซอร์ล้างหน้า", price: "390", reason: "ล้างกันแดดออกให้หมดจด ลดการอุดตันสิว", promo: "" },
      { trigger: "เซรั่มวิตามินซี", partner: "มอยส์เจอไรเซอร์", price: "450", reason: "ล็อกความชุ่มชื้นให้วิตซีทำงานได้เต็มที่", promo: "แถมตัวอย่างขนาดทดลอง" },
    ],
  },
  {
    username: "doihom",
    name: "ร้านกาแฟดอยหอม",
    voice: "สุภาพ อบอุ่น ลงท้าย 'ครับ' ให้ข้อมูลแบบคนรักกาแฟ",
    rules: [
      { trigger: "เมล็ดกาแฟคั่ว", partner: "ดริปเปอร์เซรามิก", price: "350", reason: "ชงดริปเองที่บ้านได้รสชาติเต็มเมล็ด", promo: "" },
      { trigger: "ชุดดริปกาแฟ", partner: "กระดาษกรอง 100 แผ่น", price: "90", reason: "ใช้คู่กับดริปเปอร์พอดี ได้กาแฟใสไม่มีตะกอน", promo: "ซื้อ 2 แถม 1" },
    ],
  },
  {
    username: "minimoda",
    name: "ร้านแฟชั่นมินิมอล",
    voice: "ทันสมัย กระชับ ลงท้าย 'ค่ะ' แนะนำการแมตช์ลุค",
    rules: [
      { trigger: "เดรสยาวซัมเมอร์", partner: "กระเป๋าสานหวาย", price: "590", reason: "แมตช์ลุคซัมเมอร์ให้ดูครบเซ็ตทันที", promo: "" },
      { trigger: "เสื้อเชิ้ตโอเวอร์ไซส์", partner: "เข็มขัดหนัง", price: "320", reason: "ช่วยเก็บทรงให้ดูเรียบหรูมีสไตล์", promo: "ลด 15% เมื่อซื้อพร้อมเสื้อ" },
    ],
  },
  {
    username: "healthypro",
    name: "ร้านอาหารเสริมเฮลตี้โปร",
    voice: "ให้ข้อมูลน่าเชื่อถือ ไม่โอเวอร์ ลงท้าย 'ค่ะ' ระวังคำอ้างสรรพคุณ",
    rules: [
      { trigger: "คอลลาเจนเปปไทด์", partner: "วิตามินซีเม็ดฟู่", price: "350", reason: "วิตซีช่วยการสังเคราะห์คอลลาเจนของร่างกาย", promo: "" },
      { trigger: "เวย์โปรตีน", partner: "แก้วเชคเกอร์", price: "150", reason: "ผสมโปรตีนให้เนียนไม่เป็นก้อน พกพาสะดวก", promo: "แถมเมื่อซื้อเวย์ขนาด 2 ปอนด์" },
    ],
  },
];

const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
const pool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', voice TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      "trigger" TEXT NOT NULL DEFAULT '', partner TEXT NOT NULL DEFAULT '', price TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '', promo TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
  `);
}

async function main() {
  const client = await pool.connect();
  let created = 0;
  let skipped = 0;
  try {
    await ensureSchema(client);
    for (const shop of shops) {
      const exists = await client.query("SELECT 1 FROM admins WHERE username = $1", [shop.username]);
      if (exists.rowCount > 0) {
        console.log(`- ข้าม @${shop.username} (มีอยู่แล้ว)`);
        skipped++;
        continue;
      }
      const shopId = randomUUID();
      const adminId = randomUUID();
      const now = Date.now();
      await client.query("BEGIN");
      await client.query("INSERT INTO shops (id, name, voice, created_at) VALUES ($1,$2,$3,$4)", [shopId, shop.name, shop.voice, now]);
      await client.query(
        "INSERT INTO admins (id, shop_id, username, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)",
        [adminId, shopId, shop.username, hashPassword(DEMO_PASSWORD), now],
      );
      for (let i = 0; i < shop.rules.length; i++) {
        const r = shop.rules[i];
        await client.query(
          `INSERT INTO rules (id, shop_id, "trigger", partner, price, reason, promo, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), shopId, r.trigger, r.partner, r.price, r.reason, r.promo, i],
        );
      }
      await client.query("COMMIT");
      console.log(`+ สร้าง @${shop.username} — ${shop.name} (${shop.rules.length} คู่พ่วง)`);
      created++;
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\nเสร็จ: สร้างใหม่ ${created} ร้าน, ข้าม ${skipped} ร้าน`);
  console.log(`รหัสผ่านทุกบัญชี: ${DEMO_PASSWORD}`);
}

main().catch((e) => {
  console.error("seed ล้มเหลว:", e.message);
  process.exit(1);
});
