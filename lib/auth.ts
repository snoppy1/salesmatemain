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

/* ---------- นโยบายรหัสผ่าน (ตามข้อกำหนดความปลอดภัย Lazada sec 5.1) ---------- */

/** อายุรหัสผ่านสูงสุด 90 วัน — เกินแล้วต้องเปลี่ยนก่อนเข้าใช้ */
export const PASSWORD_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** กันตั้งรหัสซ้ำกับ 4 ครั้งล่าสุด */
export const PASSWORD_HISTORY_KEEP = 4;

/** ตรวจความแข็งแรง: ≥8 ตัว มีตัวอักษร+ตัวเลข+อักขระพิเศษ — คืนข้อความ error หรือ null ถ้าผ่าน */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร";
  if (!/[A-Za-z]/.test(password)) return "รหัสผ่านต้องมีตัวอักษร (a-z) อย่างน้อย 1 ตัว";
  if (!/[0-9]/.test(password)) return "รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว";
  if (!/[^A-Za-z0-9]/.test(password))
    return "รหัสผ่านต้องมีอักขระพิเศษอย่างน้อย 1 ตัว (เช่น ! @ # $)";
  return null;
}

/** รหัสใหม่ซ้ำกับ 4 ครั้งล่าสุดไหม (ใช้ตอนเปลี่ยน/รีเซ็ตรหัส) */
export async function isPasswordReused(
  adminId: string,
  newPassword: string,
): Promise<boolean> {
  const rows = await query<{ password_hash: string }>(
    `SELECT password_hash FROM password_history
      WHERE admin_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [adminId, PASSWORD_HISTORY_KEEP],
  );
  return rows.some((r) => verifyPassword(newPassword, r.password_hash));
}

/** บันทึกประวัติรหัส (คงไว้แค่ 4 รายการล่าสุด) + ประทับเวลาเปลี่ยนรหัส */
export async function recordPasswordChange(
  adminId: string,
  passwordHash: string,
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO password_history (id, admin_id, password_hash, created_at)
     VALUES ($1, $2, $3, $4)`,
    [newId(), adminId, passwordHash, now],
  );
  await query(
    `DELETE FROM password_history
      WHERE admin_id = $1 AND id NOT IN (
        SELECT id FROM password_history WHERE admin_id = $1
        ORDER BY created_at DESC LIMIT $2)`,
    [adminId, PASSWORD_HISTORY_KEEP],
  );
  await query("UPDATE admins SET password_updated_at = $1 WHERE id = $2", [now, adminId]);
}

/** รหัสผ่านหมดอายุหรือยัง (บัญชี OAuth/บัญชีก่อนมีระบบนี้ → เริ่มนับเมื่อเปลี่ยนครั้งแรก) */
export function isPasswordExpired(passwordUpdatedAt: number | null): boolean {
  if (!passwordUpdatedAt) return false;
  return Date.now() - passwordUpdatedAt > PASSWORD_MAX_AGE_MS;
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

  const admin = await queryOne<{ id: string; shop_id: string; username: string; email: string | null }>(
    "SELECT id, shop_id, username, email FROM admins WHERE id = $1",
    [session.admin_id],
  );
  if (!admin) return null;

  return { id: admin.id, shopId: admin.shop_id, username: admin.username, email: admin.email };
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
  // บัญชีแบบรหัสผ่าน: เริ่มนับอายุรหัส + เก็บประวัติ (กันตั้งซ้ำตอนเปลี่ยนภายหลัง)
  if (a.passwordHash) await recordPasswordChange(adminId, a.passwordHash);
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
): Promise<{ id: string; password_hash: string; password_updated_at: number | null } | null> {
  const row = await queryOne<{
    id: string;
    password_hash: string;
    password_updated_at: string | null;
  }>(
    "SELECT id, password_hash, password_updated_at FROM admins WHERE lower(username) = $1 OR lower(email) = $1 LIMIT 1",
    [identifier.toLowerCase()],
  );
  if (!row) return null;
  return {
    id: row.id,
    password_hash: row.password_hash,
    password_updated_at: row.password_updated_at ? Number(row.password_updated_at) : null,
  };
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
