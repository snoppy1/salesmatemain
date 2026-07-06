import "server-only";
import { refreshImToken } from "./lazadaChatClient";
import { updateChannelTokens, type LazadaChannelRow } from "./lazadaChannelRepo";

/**
 * ต่ออายุ token Lazada IM แบบฉวยโอกาสจาก traffic จริง (เรียกใน after() ของ webhook)
 *
 * เหตุผล: refresh token ของแอป IM อายุแค่ ~24 ชม. (ยืนยันจาก refresh_expires_in) เท่า access token
 * ถ้าพึ่ง cron อย่างเดียวแล้วมีช่วงขาด >24 ชม. → refresh token ตายถาวร ต้องเชื่อมใหม่
 * การต่ออายุจากทุก webhook ที่ลูกค้าทัก ทำให้ร้านที่ใช้งานอยู่ token สดตลอด ไม่พึ่งความเสถียรของ cron
 */
const REFRESH_WINDOW_MS = 18 * 3600e3; // ต่ออายุเมื่อ access token เหลือ <18 ชม.
const MIN_GAP_MS = 30 * 60e3; // แต่ไม่ถี่กว่า 30 นาที (กัน refresh ซ้ำถี่จาก webhook รัวๆ)

export async function refreshLazadaIfDue(channel: LazadaChannelRow): Promise<void> {
  const exp = channel.expires_at != null ? Number(channel.expires_at) : 0;
  const updated = Number(channel.updated_at || 0);
  const now = Date.now();
  // updated_at ขยับเฉพาะตอนต่ออายุ/เชื่อมสำเร็จ → gap 30 นาที = ไม่ต่อซ้ำถี่ แต่ถ้าล้มก็ retry รอบหน้า
  const due = exp > 0 && exp - now < REFRESH_WINDOW_MS && now - updated > MIN_GAP_MS;
  if (!due || !channel.refresh_token) return;
  try {
    const r = await refreshImToken(channel.refresh_token);
    if (r.ok) {
      await updateChannelTokens(channel.shop_id, r.accessToken, r.refreshToken, r.expiresAt);
    }
  } catch {
    /* best-effort — ล้มแล้ว cron/webhook รอบหน้าลองต่อ */
  }
}
