import "server-only";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne, withTx } from "./db";
import type { Admin } from "./types";

export const SESSION_COOKIE = "phuang_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 วัน

/* ---------- password ---------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = scryptSync(password, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/* ---------- session ---------- */

export async function createSession(
  adminId: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await query(
    "INSERT INTO sessions (token, admin_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [token, adminId, now, expiresAt],
  );
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

/** อ่าน admin ปัจจุบันจาก session cookie (null ถ้าไม่ล็อกอิน/หมดอายุ) */
export async function getCurrentAdmin(): Promise<Admin | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await queryOne<{ admin_id: string; expires_at: string }>(
    "SELECT admin_id, expires_at FROM sessions WHERE token = $1",
    [token],
  );
  if (!session) return null;
  if (Number(session.expires_at) < Date.now()) {
    await destroySession(token);
    return null;
  }

  const admin = await queryOne<{ id: string; shop_id: string; username: string }>(
    "SELECT id, shop_id, username FROM admins WHERE id = $1",
    [session.admin_id],
  );
  if (!admin) return null;

  return { id: admin.id, shopId: admin.shop_id, username: admin.username };
}

/* ---------- cookie helpers ---------- */

export async function setSessionCookie(
  token: string,
  expiresAt: number,
  remember = true,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // remember = ค้าง session ถึงวันหมดอายุ; ไม่ remember = หายเมื่อปิดเบราว์เซอร์
    ...(remember ? { expires: new Date(expiresAt) } : {}),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/* ---------- helpers ใช้ตอนสร้างบัญชี ---------- */

export function newId(): string {
  return randomUUID();
}

/* ---------- บัญชี (อีเมล + Google) ---------- */

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type NewAccount = {
  shopName: string;
  username: string; // ตัวระบุสำหรับล็อกอิน (สมัครด้วยอีเมล = อีเมล lowercase)
  email?: string | null;
  passwordHash?: string | null;
  googleId?: string | null;
};

/** สร้างร้าน + แอดมิน (ใช้ทั้งสมัครด้วยอีเมล และ Google sign-in) → คืน adminId */
export async function createAccount(a: NewAccount): Promise<string> {
  const shopId = newId();
  const adminId = newId();
  const now = Date.now();
  // บัญชี Google ไม่มีรหัสผ่าน → เก็บค่าที่ verifyPassword จะปฏิเสธเสมอ (ไม่ใช่ scrypt$)
  const pwd = a.passwordHash ?? `oauth$${randomBytes(16).toString("hex")}`;
  await withTx(async (client) => {
    await client.query(
      "INSERT INTO shops (id, name, voice, created_at) VALUES ($1, $2, '', $3)",
      [shopId, a.shopName, now],
    );
    await client.query(
      "INSERT INTO admins (id, shop_id, username, password_hash, email, google_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [adminId, shopId, a.username, pwd, a.email ?? null, a.googleId ?? null, now],
    );
  });
  return adminId;
}

/** ตัวระบุ (อีเมล/username) ถูกใช้ไปแล้วไหม */
export async function identifierTaken(id: string): Promise<boolean> {
  const r = await queryOne(
    "SELECT 1 AS ok FROM admins WHERE lower(username) = $1 OR lower(email) = $1",
    [id.toLowerCase()],
  );
  return Boolean(r);
}

/** หาแอดมินสำหรับล็อกอินด้วยอีเมลหรือ username (รับรหัสผ่าน) */
export async function findAdminForLogin(
  identifier: string,
): Promise<{ id: string; password_hash: string } | null> {
  return (
    (await queryOne<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM admins WHERE lower(username) = $1 OR lower(email) = $1 LIMIT 1",
      [identifier.toLowerCase()],
    )) ?? null
  );
}

/** หาแอดมินจาก Google (ตาม google_id หรืออีเมลที่ตรงกัน) */
export async function findAdminByGoogle(
  googleId: string,
  email: string,
): Promise<{ id: string } | null> {
  return (
    (await queryOne<{ id: string }>(
      "SELECT id FROM admins WHERE google_id = $1 OR lower(email) = $2 LIMIT 1",
      [googleId, email.toLowerCase()],
    )) ?? null
  );
}

/** ผูก google_id เข้ากับบัญชีที่มีอยู่ (เผื่อสมัครอีเมลไว้ก่อนแล้วมาเข้าด้วย Google) */
export async function linkGoogleId(adminId: string, googleId: string): Promise<void> {
  await query("UPDATE admins SET google_id = COALESCE(google_id, $1) WHERE id = $2", [
    googleId,
    adminId,
  ]);
}
