import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";

export const SUPER_COOKIE = "phuang_super";
const SUPER_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 วัน (โซนคุมระบบ ให้สั้นกว่าปกติ)

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** เปิดใช้งานโซน superadmin เฉพาะเมื่อมีการตั้ง env ครบ */
export function isSuperEnabled(): boolean {
  return Boolean(process.env.PHUANG_ADMIN_USER && process.env.PHUANG_ADMIN_PASS);
}

/** ตรวจ user/pass กับ environment variable (ไม่เก็บใน DB) */
export function checkSuperCredentials(username: string, password: string): boolean {
  const u = process.env.PHUANG_ADMIN_USER;
  const p = process.env.PHUANG_ADMIN_PASS;
  if (!u || !p) return false;
  // เทียบทั้งสองช่องเสมอ ไม่ short-circuit เพื่อลด timing leak
  const okUser = safeEqual(username, u);
  const okPass = safeEqual(password, p);
  return okUser && okPass;
}

export async function createSuperSession(
  username: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SUPER_TTL_MS;
  await query(
    "INSERT INTO super_sessions (token, username, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [token, username, now, expiresAt],
  );
  return { token, expiresAt };
}

export async function destroySuperSession(token: string): Promise<void> {
  await query("DELETE FROM super_sessions WHERE token = $1", [token]);
}

/** อ่าน superadmin ปัจจุบันจาก cookie (null ถ้าไม่ใช่/หมดอายุ/ปิดใช้งาน) */
export async function getCurrentSuperadmin(): Promise<{ username: string } | null> {
  if (!isSuperEnabled()) return null;
  const store = await cookies();
  const token = store.get(SUPER_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<{ username: string; expires_at: string }>(
    "SELECT username, expires_at FROM super_sessions WHERE token = $1",
    [token],
  );
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await destroySuperSession(token);
    return null;
  }
  return { username: row.username };
}

export async function setSuperCookie(token: string, expiresAt: number): Promise<void> {
  const store = await cookies();
  store.set(SUPER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSuperCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SUPER_COOKIE);
}
