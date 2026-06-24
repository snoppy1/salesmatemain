import "server-only";
import { put, del } from "@vercel/blob";
import { randomBytes } from "node:crypto";

/**
 * โฮสต์รูปจากแชต (โดยเฉพาะ LINE ที่ลิงก์รูปใช้ token + หมดอายุ) บน Vercel Blob
 * - ถ้าไม่ตั้ง BLOB_READ_WRITE_TOKEN → putImage จะ throw, ฝั่งเรียกต้อง fallback เป็นป้ายข้อความ
 */

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function extFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** อัปโหลดรูปขึ้น Vercel Blob (public) → คืน url + key (key ไว้ลบทีหลัง) */
export async function putImage(
  buffer: Buffer,
  contentType: string,
): Promise<{ url: string; key: string }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_NOT_CONFIGURED");
  const key = `chat-images/${Date.now()}-${randomBytes(6).toString("hex")}.${extFor(contentType)}`;
  const res = await put(key, buffer, {
    access: "public",
    token,
    contentType,
    addRandomSuffix: false,
  });
  return { url: res.url, key };
}

/** ลบไฟล์ออกจาก Blob — best-effort (ไม่ throw) */
export async function delBlobs(keys: string[]): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || keys.length === 0) return;
  try {
    await del(keys, { token });
  } catch {
    /* เงียบไว้ — best-effort */
  }
}
