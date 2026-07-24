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

    CREATE TABLE IF NOT EXISTS allowed_emails (
      email      TEXT PRIMARY KEY,
      note       TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
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
    -- จำนวนสต็อกคงเหลือ (รวม/ที่ใช้ตอบลูกค้า) + แยกรายแพลตฟอร์ม (เช่น {"lazada":12,"shopee":8})
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_by_platform JSONB;
    -- ชื่อฉบับย่อสำหรับ AI (ล้างคำโฆษณา/อีโมจิจากชื่อ Lazada แล้ว) — NULL = ใช้ name เดิม
    ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_name TEXT;
    -- เปิด/ปิดรายการ (false = หมดสต็อก/ปิดใช้ AI ไม่เอาไปคิด)
    ALTER TABLE products ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE rules ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
    -- LINE AI ตอบ (เฟส 2): ค่าเริ่มต้น auto ของร้าน, สถานะรอคนตอบ, กันตอบซ้ำ
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS auto_reply BOOLEAN NOT NULL DEFAULT false;
    -- ระดับการตอบของ AI: off | safe | night | full (ไม่มีค่า = อนุมานจาก auto_reply)
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS auto_level TEXT;
    -- ตั้งค่า "ข้อมูลทดลอง (mock)" แยกต่อแพลตฟอร์ม เช่น {"lazada":{"chat":true,"catalog":false}}
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS mock_settings JSONB;
    -- "สิ่งที่ AI ควรจำ": ข้อมูล/นโยบายร้าน (ค่าส่ง/จ่ายเงิน/รับประกัน ฯลฯ) ให้ AI ตอบเองได้
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS ai_memory TEXT NOT NULL DEFAULT '';
    -- เพศของผู้ช่วย AI: 'male' (ลงท้าย ครับ) | 'female' (ลงท้าย ค่ะ/คะ) | NULL (ยังไม่เลือก → default หญิง)
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS ai_gender TEXT;
    -- บัญชีแอดมิน: อีเมล (ใช้ล็อกอิน/รีเซ็ตรหัส) + Google sign-in (sub id)
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS google_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_email ON admins(email) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_google ON admins(google_id) WHERE google_id IS NOT NULL;
    -- นโยบายรหัสผ่าน (ตามข้อกำหนด Lazada 5.1): อายุรหัส + ประวัติกันใช้ซ้ำ 4 ครั้งล่าสุด
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_updated_at BIGINT;
    CREATE TABLE IF NOT EXISTS password_history (
      id            TEXT PRIMARY KEY,
      admin_id      TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      created_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pwhistory_admin ON password_history(admin_id, created_at DESC);
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_human BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS ext_id TEXT;
    -- ชนิดข้อความ + รูป (เก็บลิงก์ CDN ของแพลตฟอร์ม หรือ blob ที่เราโฮสต์เอง)
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS blob_key TEXT;
    -- ข้อความที่ AI ตอบเอง (แยกจากแอดมินพิมพ์) — ใช้นับโควตา/ต้นทุน ต่อยอด subscription จำกัดข้อความ/วัน
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_messages_blob ON messages(blob_key) WHERE blob_key IS NOT NULL;

    -- แอปที่ร้านเพิ่มเข้ากล่องแชต + โหมด AI แยกต่อแอป (off/safe/full)
    CREATE TABLE IF NOT EXISTS inbox_apps (
      shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      channel    TEXT NOT NULL,
      auto_level TEXT NOT NULL DEFAULT 'off',
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (shop_id, channel)
    );

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

    -- credential ของบัญชีแชต Shopee แยกต่อร้าน (1 ร้าน 1 บัญชี)
    CREATE TABLE IF NOT EXISTS shopee_channels (
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

    -- โปรโมชั่นที่ sync มาจาก Lazada (ระดับร้าน) ให้ AI แนะนำลูกค้า
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

    -- เหตุการณ์ "AI เสนอพ่วงและส่งถึงลูกค้า" (วัดยอดพ่วง) — คอลัมน์ sold/* เผื่อ B3
    CREATE TABLE IF NOT EXISTS upsell_events (
      id               TEXT PRIMARY KEY,
      shop_id          TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      conversation_id  TEXT NOT NULL,
      channel          TEXT NOT NULL DEFAULT '',
      product          TEXT NOT NULL DEFAULT '',
      est_value        INTEGER,
      created_at       BIGINT NOT NULL,
      sold             BOOLEAN NOT NULL DEFAULT false,
      sold_value       INTEGER,
      matched_order_id TEXT
    );

    -- นับความพยายาม login/signup/forgot ต่อช่วงเวลา (rate limit กัน brute force / สแปม)
    CREATE TABLE IF NOT EXISTS auth_throttle (
      key      TEXT PRIMARY KEY,
      count    INTEGER NOT NULL DEFAULT 0,
      reset_at BIGINT NOT NULL
    );

    -- log การเปลี่ยนของสินค้าจากระบบซิงก์ marketplace — ไว้วิเคราะห์ว่าอะไรทำดัชนีแคชถูกจุดใหม่
    -- (เก็บเฉพาะการเปลี่ยนจริง ปริมาณน้อย; ลบทิ้งได้ทุกเมื่อ ไม่มีอะไรพึ่งพา)
    CREATE TABLE IF NOT EXISTS product_sync_changes (
      id         TEXT PRIMARY KEY,
      shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT '',
      change     TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_psc_shop ON product_sync_changes(shop_id, created_at DESC);

    -- "ยอดขายที่ AI มีส่วนช่วย": ออเดอร์ที่มีสินค้าตรงกับการ์ดที่ AI ส่งในแชต (เกิดหลังส่ง ใน 7 วัน)
    -- UNIQUE (shop, order, item) = 1 รายการซื้อนับครั้งเดียว ต่อให้ส่งการ์ดหลายรอบ/หลายบทสนทนา
    CREATE TABLE IF NOT EXISTS assist_matches (
      id         TEXT PRIMARY KEY,
      shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      product    TEXT NOT NULL DEFAULT '',
      item_name  TEXT NOT NULL DEFAULT '',
      order_id   TEXT NOT NULL,
      sold_value INTEGER,
      card_at    BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE (shop_id, order_id, item_name)
    );
    CREATE INDEX IF NOT EXISTS idx_assist_shop ON assist_matches(shop_id, created_at DESC);

    -- ต้นทุน AI จริงต่อการเรียก (จาก usage ของ Anthropic) — ฐานคิดต้นทุน/แพ็กเกจ
    CREATE TABLE IF NOT EXISTS ai_usage (
      id           TEXT PRIMARY KEY,
      shop_id      TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      model        TEXT NOT NULL,
      kind         TEXT NOT NULL DEFAULT 'reply', -- reply | choices | order | prewarm
      in_tokens    INTEGER NOT NULL DEFAULT 0,
      out_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_write  INTEGER NOT NULL DEFAULT 0,
      cache_read   INTEGER NOT NULL DEFAULT 0,
      cost_thb     DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_shop ON ai_usage(shop_id, created_at DESC);

    -- บันทึกการรันของ cron (หน้าสถานะระบบใน admin console) — เก็บ 50 รายการล่าสุดต่อ job
    CREATE TABLE IF NOT EXISTS cron_runs (
      id     TEXT PRIMARY KEY,
      job    TEXT NOT NULL,
      ran_at BIGINT NOT NULL,
      ok     BOOLEAN NOT NULL DEFAULT true,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job, ran_at DESC);

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
    CREATE INDEX IF NOT EXISTS idx_shopee_channels_account ON shopee_channels(account_id);
    CREATE INDEX IF NOT EXISTS idx_promotions_shop ON promotions(shop_id);
    CREATE INDEX IF NOT EXISTS idx_upsell_events_shop ON upsell_events(shop_id);
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
