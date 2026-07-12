import "server-only";
import { query } from "./db";

/** บัญชีที่ลงทะเบียนในระบบ + สถานะสิทธิ์เปิดกล่องแชต (สำหรับคอนโซลแอดมิน) */
export type AccountRow = {
  id: string;
  email: string; // อีเมลที่ใช้จริง (email ถ้ามี ไม่งั้น username) — ตรงกับที่ใช้เช็คสิทธิ์
  shopId: string;
  shopName: string;
  createdAt: number;
  hasChatAccess: boolean; // อยู่ใน allowed_emails ไหม (มีสิทธิ์เปิดกล่องแชต)
};

/**
 * บัญชีทั้งหมด + flag สิทธิ์กล่องแชต
 * - อีเมลที่ใช้เช็คสิทธิ์ = COALESCE(NULLIF(email,''), username) ให้ตรงกับ chatAllowed ใน /api/inbox/apps
 *   (allowed_emails เก็บ lowercase เสมอ → join ด้วย lower(...))
 * - LEFT JOIN ทั้ง shops และ allowed_emails ในคิวรีเดียว — ไม่ N+1
 */
export async function listAccounts(): Promise<AccountRow[]> {
  const rows = await query<{
    id: string;
    email: string;
    shop_id: string;
    shop_name: string | null;
    created_at: string;
    has_access: boolean;
  }>(
    `SELECT a.id,
            COALESCE(NULLIF(a.email, ''), a.username)            AS email,
            a.shop_id,
            s.name                                                AS shop_name,
            a.created_at,
            (ae.email IS NOT NULL)                                AS has_access
       FROM admins a
       LEFT JOIN shops s          ON s.id = a.shop_id
       LEFT JOIN allowed_emails ae ON ae.email = lower(COALESCE(NULLIF(a.email, ''), a.username))
      ORDER BY a.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    shopId: r.shop_id,
    shopName: r.shop_name ?? "",
    createdAt: Number(r.created_at),
    hasChatAccess: r.has_access,
  }));
}
