import "server-only";
import { query } from "./db";
import { delBlobs } from "./blobStore";

/** ค่าปรับได้ที่เดียว — กัน database/Blob บวม + ตามนโยบาย Lazada (ลบข้อมูลภายใน 3 เดือน) */
export const RETENTION = {
  keepMessagesPerConversation: 50,
  purgeConversationsAfterDays: 90, // 3 เดือน — Lazada: หลังจบออเดอร์เก็บได้ไม่เกิน 3 เดือน แล้วต้องลบถาวร
  deleteHostedImagesAfterDays: 60,
};

/** เก็บแค่ N ข้อความล่าสุดต่อบทสนทนา ลบที่เก่ากว่า + ลบไฟล์รูปที่เราโฮสต์ (best-effort) */
export async function trimConversation(conversationId: string): Promise<void> {
  try {
    const keep = RETENTION.keepMessagesPerConversation;
    const doomed = await query<{ id: string; blob_key: string | null }>(
      `SELECT id, blob_key FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       OFFSET $2`,
      [conversationId, keep],
    );
    if (doomed.length === 0) return;
    const ids = doomed.map((d) => d.id);
    const keys = doomed
      .map((d) => d.blob_key)
      .filter((k): k is string => Boolean(k));
    await delBlobs(keys);
    await query("DELETE FROM messages WHERE id = ANY($1)", [ids]);
  } catch {
    /* เงียบไว้ — ห้ามกระทบ flow รับข้อความ */
  }
}

const DAY = 24 * 3600 * 1000;

/** ลบบทสนทนาที่เงียบเกิน N วัน (cascade ลบ messages) + ลบไฟล์รูปในนั้น */
export async function purgeOldConversations(): Promise<number> {
  const cutoff = Date.now() - RETENTION.purgeConversationsAfterDays * DAY;
  const convos = await query<{ id: string }>(
    "SELECT id FROM conversations WHERE last_message_at < $1",
    [cutoff],
  );
  if (convos.length === 0) return 0;
  const ids = convos.map((c) => c.id);
  const blobs = await query<{ blob_key: string }>(
    "SELECT blob_key FROM messages WHERE conversation_id = ANY($1) AND blob_key IS NOT NULL",
    [ids],
  );
  await delBlobs(blobs.map((b) => b.blob_key));
  await query("DELETE FROM conversations WHERE id = ANY($1)", [ids]); // messages cascade via FK
  return ids.length;
}

/** รูปที่เราโฮสต์ (blob_key) เก่าเกิน N วัน → ลบไฟล์ เหลือป้ายข้อความ */
export async function expireOldImages(): Promise<number> {
  const cutoff = Date.now() - RETENTION.deleteHostedImagesAfterDays * DAY;
  const rows = await query<{ id: string; blob_key: string }>(
    "SELECT id, blob_key FROM messages WHERE kind = 'image' AND blob_key IS NOT NULL AND created_at < $1",
    [cutoff],
  );
  if (rows.length === 0) return 0;
  await delBlobs(rows.map((r) => r.blob_key));
  await query(
    `UPDATE messages SET kind = 'text', image_url = NULL, blob_key = NULL, text = '🖼️ รูป (หมดอายุ)'
     WHERE id = ANY($1)`,
    [rows.map((r) => r.id)],
  );
  return rows.length;
}
