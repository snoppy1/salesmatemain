import "server-only";
import { query, queryOne } from "./db";

/**
 * Rate limit แบบ fixed window เก็บใน Postgres (ใช้ร่วมกันได้ทุก serverless instance)
 * key = "ประเภท:ตัวระบุ" เช่น "login:a@b.com", "login-ip:1.2.3.4", "signup-ip:1.2.3.4"
 * แถวหมดอายุแล้วถูกเขียนทับตอนนับครั้งถัดไป — ไม่ต้องมี job เก็บกวาด
 */

/** ยังอยู่ในโควตาไหม (ไม่นับเพิ่ม — เรียก recordAttempt แยกตอนเกิดเหตุจริง) */
export async function allowAttempt(key: string, limit: number): Promise<boolean> {
  const row = await queryOne<{ count: number; reset_at: string }>(
    "SELECT count, reset_at FROM auth_throttle WHERE key = $1",
    [key],
  );
  if (!row || Number(row.reset_at) <= Date.now()) return true; // หน้าต่างหมดอายุ = เริ่มใหม่ได้
  return Number(row.count) < limit;
}

/** นับ 1 ครั้ง (เริ่มหน้าต่างใหม่ถ้าอันเดิมหมดอายุ) — best-effort ห้ามทำให้ flow หลักล้ม */
export async function recordAttempt(key: string, windowMs: number): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO auth_throttle (key, count, reset_at) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count    = CASE WHEN auth_throttle.reset_at <= $3 THEN 1 ELSE auth_throttle.count + 1 END,
       reset_at = CASE WHEN auth_throttle.reset_at <= $3 THEN $2 ELSE auth_throttle.reset_at END`,
    [key, now + windowMs, now],
  ).catch(() => {});
}

/** ล้างตัวนับ (เช่น login สำเร็จ = ไม่ใช่คนเดารหัส) */
export async function clearThrottle(key: string): Promise<void> {
  await query("DELETE FROM auth_throttle WHERE key = $1", [key]).catch(() => {});
}

/** IP จริงของผู้เรียก (Vercel ใส่ตัวจริงไว้ตัวแรกใน x-forwarded-for) */
export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for") ?? "";
  return xf.split(",")[0].trim() || "unknown";
}
