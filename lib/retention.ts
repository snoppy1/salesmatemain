import "server-only";
import { query } from "./db";
import { delBlobs } from "./blobStore";

/** ค่าปรับได้ที่เดียว — กัน database/Blob บวม */
export const RETENTION = {
  keepMessagesPerConversation: 50,
  purgeConversationsAfterDays: 365,
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
