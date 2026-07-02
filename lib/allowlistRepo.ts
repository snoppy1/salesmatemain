import "server-only";
import { query, queryOne } from "./db";

/** อีเมลที่ได้รับอนุญาตให้ "สมัครใหม่" (beta gate) — เก็บ lowercase เสมอ */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const row = await queryOne<{ email: string }>(
    "SELECT email FROM allowed_emails WHERE email = $1",
    [normalizeEmail(email)],
  );
  return Boolean(row);
}

/** เพิ่มอีเมล (ซ้ำ = อัปเดตโน้ต ไม่ error) */
export async function addAllowedEmail(email: string, note = ""): Promise<void> {
  await query(
    `INSERT INTO allowed_emails (email, note, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note`,
    [normalizeEmail(email), note.trim(), Date.now()],
  );
}

export async function removeAllowedEmail(email: string): Promise<void> {
  await query("DELETE FROM allowed_emails WHERE email = $1", [normalizeEmail(email)]);
}

export type AllowedEmailRow = {
  email: string;
  note: string;
  createdAt: number;
  registered: boolean; // มีบัญชีใน admins แล้วหรือยัง
};

export async function listAllowedEmails(): Promise<AllowedEmailRow[]> {
  const rows = await query<{
    email: string;
    note: string;
    created_at: string;
    registered: boolean;
  }>(
    `SELECT ae.email, ae.note, ae.created_at,
            EXISTS (SELECT 1 FROM admins a WHERE lower(a.email) = ae.email) AS registered
     FROM allowed_emails ae
     ORDER BY ae.created_at DESC`,
  );
  return rows.map((r) => ({
    email: r.email,
    note: r.note,
    createdAt: Number(r.created_at),
    registered: r.registered,
  }));
}
