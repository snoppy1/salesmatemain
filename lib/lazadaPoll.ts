import "server-only";
import { listRecentSessions, fetchHistory, probeImToken, refreshImToken } from "./lazadaChatClient";
import { listAllChannels, updateChannelTokens, markChannelTokenDead } from "./lazadaChannelRepo";
import {
  upsertCustomer,
  ensureConversation,
  backfillMessages,
  latestLazadaMessageAt,
  latestMessageBrief,
  getConversationMode,
} from "./inboxRepo";
import { processAutoReply } from "./autoReply";
import { shouldWakePolledReply } from "./autoWake";

/**
 * ดึงแชต Lazada ใหม่ผ่าน API เป็น backstop กัน push หยุด (Lazada push ไม่เสถียร บางทีหยุดแม้ token ดี)
 * เรียกจาก cron ทุก ~30 นาที — ถ้า push พลาด แชตจะเข้าเองภายในรอบถัดไป
 * กันซ้ำ: backfillMessages dedup ด้วย ext_id (message_id) → ข้อความที่ push เข้าแล้วไม่เบิ้ล
 */
const LOOKBACK_FALLBACK_MS = 6 * 3600e3; // ร้านที่ยังไม่มีแชต Lazada → ดึงย้อนแค่ 6 ชม. (ไม่ backfill ทั้งหมด)

async function pollChannel(channel: {
  shop_id: string;
  access_token: string;
  refresh_token: string;
}): Promise<{ added: number; woken: number }> {
  const { shop_id: shopId } = channel;
  let token = channel.access_token;
  if (!token || token.startsWith("mock")) return { added: 0, woken: 0 };

  // ตรวจ token กับ Lazada จริงก่อนทุกรอบ — expires_at ที่จดไว้เชื่อไม่ได้ (เคยตายก่อนกำหนด ~6 วัน)
  const probe = await probeImToken(token);
  if (probe === "IllegalAccessToken") {
    const r = channel.refresh_token ? await refreshImToken(channel.refresh_token) : null;
    if (r?.ok) {
      await updateChannelTokens(shopId, r.accessToken, r.refreshToken, r.expiresAt);
      token = r.accessToken; // กู้สำเร็จ — poll ต่อด้วย token ใหม่ในรอบนี้เลย
      console.error(`[lazadaPoll] token ตายก่อนกำหนด แต่กู้ด้วย refresh สำเร็จ (shop ${shopId.slice(0, 8)})`);
    } else {
      await markChannelTokenDead(shopId); // กู้ไม่ได้ — ขึ้นแดงหน้าสถานะทันที ร้านต้องเชื่อมใหม่
      console.error(`[lazadaPoll] token ตายและกู้ไม่ได้ (${r?.error ?? "no refresh token"}) — ร้าน ${shopId.slice(0, 8)} ต้องเชื่อมแชต Lazada ใหม่`);
      return { added: 0, woken: 0 };
    }
  }

  const since = (await latestLazadaMessageAt(shopId)) ?? Date.now() - LOOKBACK_FALLBACK_MS;
  const sessions = await listRecentSessions(token, since);
  let added = 0;
  const touched = new Set<string>(); // แชตที่มีข้อความกู้เข้ามาใหม่รอบนี้
  for (const s of sessions) {
    if (!s.buyerId || (s.lastMessageTime && s.lastMessageTime <= since)) continue;
    try {
      const customerId = await upsertCustomer(shopId, "lazada", s.buyerId, s.title, s.sessionId);
      const convId = await ensureConversation(shopId, customerId, "lazada");
      const hist = await fetchHistory(token, s.sessionId);
      const fresh = hist.filter((m) => m.createdAt > since);
      if (fresh.length) {
        const n = await backfillMessages(convId, fresh);
        if (n) {
          added += n;
          touched.add(convId);
        }
      }
    } catch {
      /* best-effort ต่อ session */
    }
  }

  // ปลุก AI ตอบข้อความที่กู้มา — เดิม poll แค่เก็บเข้ากล่อง ลูกค้าเจอความเงียบจนกว่าคนจะเห็น (8 ส.ค. รอ 3.5 ชม.)
  // เรียก processAutoReply ตรง (ข้าม debounce 10 วิ — ข้อความอายุหลายนาทีแล้ว ไม่มีเหตุต้องรอ)
  // จำกัด 2 แชต/รอบ กัน cron เกิน maxDuration 60 วิ (ตอบครั้งละ ~10-20 วิ) — เคสจริงหล่น ≤1 ข้อความ/รอบ
  let woken = 0;
  for (const convId of touched) {
    if (woken >= 2) break;
    try {
      const [last, mode] = await Promise.all([
        latestMessageBrief(convId),
        getConversationMode(convId),
      ]);
      if (!shouldWakePolledReply(last, mode, Date.now())) continue;
      await processAutoReply(shopId, convId, "");
      woken++;
    } catch {
      /* best-effort ต่อแชต */
    }
  }
  return { added, woken };
}

/** poll ทุก channel Lazada — คืนจำนวนข้อความใหม่ที่ดึงเข้ามา + จำนวนแชตที่ปลุก AI ตอบ */
export async function pollAllLazada(): Promise<{ added: number; woken: number }> {
  let added = 0;
  let woken = 0;
  for (const ch of await listAllChannels()) {
    try {
      const r = await pollChannel(ch);
      added += r.added;
      woken += r.woken;
    } catch {
      /* best-effort ต่อ channel */
    }
  }
  return { added, woken };
}
