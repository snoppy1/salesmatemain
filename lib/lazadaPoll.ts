import "server-only";
import { listRecentSessions, fetchHistory } from "./lazadaChatClient";
import { listAllChannels } from "./lazadaChannelRepo";
import {
  upsertCustomer,
  ensureConversation,
  backfillMessages,
  latestLazadaMessageAt,
} from "./inboxRepo";

/**
 * ดึงแชต Lazada ใหม่ผ่าน API เป็น backstop กัน push หยุด (Lazada push ไม่เสถียร บางทีหยุดแม้ token ดี)
 * เรียกจาก cron ทุก ~30 นาที — ถ้า push พลาด แชตจะเข้าเองภายในรอบถัดไป
 * กันซ้ำ: backfillMessages dedup ด้วย ext_id (message_id) → ข้อความที่ push เข้าแล้วไม่เบิ้ล
 */
const LOOKBACK_FALLBACK_MS = 6 * 3600e3; // ร้านที่ยังไม่มีแชต Lazada → ดึงย้อนแค่ 6 ชม. (ไม่ backfill ทั้งหมด)

async function pollChannel(channel: {
  shop_id: string;
  access_token: string;
}): Promise<number> {
  const { shop_id: shopId, access_token: token } = channel;
  if (!token || token.startsWith("mock")) return 0;
  const since = (await latestLazadaMessageAt(shopId)) ?? Date.now() - LOOKBACK_FALLBACK_MS;
  const sessions = await listRecentSessions(token, since);
  let added = 0;
  for (const s of sessions) {
    if (!s.buyerId || (s.lastMessageTime && s.lastMessageTime <= since)) continue;
    try {
      const customerId = await upsertCustomer(shopId, "lazada", s.buyerId, s.title, s.sessionId);
      const convId = await ensureConversation(shopId, customerId, "lazada");
      const hist = await fetchHistory(token, s.sessionId);
      const fresh = hist.filter((m) => m.createdAt > since);
      if (fresh.length) added += await backfillMessages(convId, fresh);
    } catch {
      /* best-effort ต่อ session */
    }
  }
  return added;
}

/** poll ทุก channel Lazada — คืนจำนวนข้อความใหม่ที่ดึงเข้ามา */
export async function pollAllLazada(): Promise<number> {
  let added = 0;
  for (const ch of await listAllChannels()) {
    try {
      added += await pollChannel(ch);
    } catch {
      /* best-effort ต่อ channel */
    }
  }
  return added;
}
