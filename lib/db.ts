import "server-only";
import { Pool, type PoolClient } from "pg";

/**
 * Postgres (Neon) — ใช้ DATABASE_URL เดียวทั้งตอนรันในเครื่องและบน Vercel
 * - Pool เก็บแบบ singleton กัน dev hot-reload / serverless สร้างซ้ำ
 * - ตารางถูกสร้างอัตโนมัติครั้งแรก (ensureSchema memoized ต่อ process)
 */
declare global {
  // eslint-disable-next-line no-var
  var __phuangPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __phuangSchema: Promise<void> | undefined;
}

function getPool(): Pool {
  if (!global.__phuangPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("ยังไม่ได้ตั้งค่า DATABASE_URL");
    }
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    global.__phuangPool = new Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return global.__phuangPool;
}

async function ensureSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      voice      TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id            TEXT PRIMARY KEY,
      shop_id       TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      id         TEXT PRIMARY KEY,
      shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      "trigger"  TEXT NOT NULL DEFAULT '',
      partner    TEXT NOT NULL DEFAULT '',
      price      TEXT NOT NULL DEFAULT '',
      reason     TEXT NOT NULL DEFAULT '',
      promo      TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id          TEXT PRIMARY KEY,
      shop_id     TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name        TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price       TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      admin_id   TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS super_sessions (
      token      TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    -- การเชื่อมต่อ marketplace (Lazada/Shopee) ต่อร้าน
    CREATE TABLE IF NOT EXISTS connections (
      id            TEXT PRIMARY KEY,
      shop_id       TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      platform      TEXT NOT NULL,
      seller_id     TEXT NOT NULL DEFAULT '',
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at    BIGINT NOT NULL,
      is_mock       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    BIGINT NOT NULL,
      UNIQUE (shop_id, platform)
    );

    -- ที่มาของสินค้า (เช่น 'lazada') + รหัสสินค้าฝั่ง marketplace
    ALTER TABLE products ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT;
    -- รูปสินค้า (data URL ที่อัปโหลด หรือ URL จาก marketplace)
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
    -- เปิด/ปิดรายการ (false = หมดสต็อก/ปิดใช้ AI ไม่เอาไปคิด)
    ALTER TABLE products ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE rules ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
    -- LINE AI ตอบ (เฟส 2): ค่าเริ่มต้น auto ของร้าน, สถานะรอคนตอบ, กันตอบซ้ำ
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS auto_reply BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_human BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS ext_id TEXT;

    -- ลูกค้าที่ทักเข้ามา (เช่นทาง LINE) ต่อร้าน
    CREATE TABLE IF NOT EXISTS customers (
      id            TEXT PRIMARY KEY,
      shop_id       TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      channel       TEXT NOT NULL DEFAULT 'line',
      line_user_id  TEXT,
      display_name  TEXT NOT NULL DEFAULT '',
      created_at    BIGINT NOT NULL,
      UNIQUE (shop_id, channel, line_user_id)
    );

    -- บทสนทนา (1 ลูกค้า 1 บทสนทนาต่อช่องทาง)
    CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      shop_id         TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      customer_id     TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      channel         TEXT NOT NULL DEFAULT 'line',
      mode            TEXT NOT NULL DEFAULT 'manual',
      last_message_at BIGINT NOT NULL,
      created_at      BIGINT NOT NULL,
      UNIQUE (customer_id, channel)
    );

    -- ข้อความในบทสนทนา (sender = 'customer' | 'admin')
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender          TEXT NOT NULL,
      text            TEXT NOT NULL DEFAULT '',
      created_at      BIGINT NOT NULL
    );

    -- credential ของ LINE OA แยกต่อร้าน (1 ร้าน 1 channel)
    CREATE TABLE IF NOT EXISTS line_channels (
      id             TEXT PRIMARY KEY,
      shop_id        TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      channel_secret TEXT NOT NULL,
      access_token   TEXT NOT NULL,
      bot_user_id    TEXT NOT NULL,
      bot_basic_id   TEXT NOT NULL DEFAULT '',
      display_name   TEXT NOT NULL DEFAULT '',
      created_at     BIGINT NOT NULL,
      updated_at     BIGINT NOT NULL,
      UNIQUE (shop_id),
      UNIQUE (bot_user_id)
    );

    -- credential ของเพจ Facebook แยกต่อร้าน (1 ร้าน 1 เพจ)
    CREATE TABLE IF NOT EXISTS facebook_channels (
      id           TEXT PRIMARY KEY,
      shop_id      TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      page_id      TEXT NOT NULL,
      access_token TEXT NOT NULL,
      page_name    TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL,
      UNIQUE (shop_id),
      UNIQUE (page_id)
    );

    -- credential ของบัญชีแชต TikTok แยกต่อร้าน (1 ร้าน 1 บัญชี)
    CREATE TABLE IF NOT EXISTS tiktok_channels (
      id           TEXT PRIMARY KEY,
      shop_id      TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      account_id   TEXT NOT NULL,
      access_token TEXT NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL,
      UNIQUE (shop_id),
      UNIQUE (account_id)
    );

    -- credential ของบัญชีแชต Lazada แยกต่อร้าน (1 ร้าน 1 บัญชี)
    CREATE TABLE IF NOT EXISTS lazada_channels (
      id           TEXT PRIMARY KEY,
      shop_id      TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      account_id   TEXT NOT NULL,
      access_token TEXT NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL,
      UNIQUE (shop_id),
      UNIQUE (account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_rules_shop ON rules(shop_id);
    CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);
    CREATE INDEX IF NOT EXISTS idx_connections_shop ON connections(shop_id);
    CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_shop ON conversations(shop_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_line_channels_bot ON line_channels(bot_user_id);
    CREATE INDEX IF NOT EXISTS idx_facebook_channels_page ON facebook_channels(page_id);
    CREATE INDEX IF NOT EXISTS idx_tiktok_channels_account ON tiktok_channels(account_id);
    CREATE INDEX IF NOT EXISTS idx_lazada_channels_account ON lazada_channels(account_id);
  `);
}

async function ready(): Promise<Pool> {
  if (!global.__phuangSchema) {
    global.__phuangSchema = ensureSchema();
  }
  await global.__phuangSchema;
  return getPool();
}

/** query ทั่วไป — คืน rows */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = await ready();
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/** query ที่คาดหวังแถวเดียว (หรือไม่มี) */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/** ทำหลายคำสั่งใน transaction เดียว */
export async function withTx<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await ready();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
