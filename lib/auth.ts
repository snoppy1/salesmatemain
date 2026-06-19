import "server-only";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
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

export async function setSessionCookie(token: string, expiresAt: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
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
