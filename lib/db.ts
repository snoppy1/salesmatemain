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

    CREATE INDEX IF NOT EXISTS idx_rules_shop ON rules(shop_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);
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
