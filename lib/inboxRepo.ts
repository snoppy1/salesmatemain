import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";
import { trimConversation } from "./retention";
import { addInboxApp, getChannelLevel } from "./inboxAppsRepo";
import type {
  ChatMessage,
  ConversationSummary,
  ConversationDetail,
} from "./types";

/** upsert ลูกค้าตาม (ร้าน, ช่องทาง, lineUserId) — คืน customerId */
export async function upsertCustomer(
  shopId: string,
  channel: string,
  lineUserId: string,
  displayName: string,
  sessionId?: string, // Lazada IM session_id ที่ใช้ส่งข้อความกลับ (ช่องอื่นไม่ต้องมี)
): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM customers WHERE shop_id = $1 AND channel = $2 AND line_user_id = $3",
    [shopId, channel, lineUserId],
  );
  if (existing) {
    if (displayName) {
      await query("UPDATE customers SET display_name = $1 WHERE id = $2", [
        displayName,
        existing.id,
      ]);
    }
    if (sessionId) {
      await query("UPDATE customers SET ext_session_id = $1 WHERE id = $2", [
        sessionId,
        existing.id,
      ]);
    }
    return existing.id;
  }
  const id = newId();
  await query(
    `INSERT INTO customers (id, shop_id, channel, line_user_id, display_name, created_at, ext_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, shopId, channel, lineUserId, displayName, Date.now(), sessionId ?? null],
  );
  return id;
}

/** หาบทสนทนาของลูกค้า (1 ลูกค้า 1 บทต่อช่องทาง) — สร้างถ้ายังไม่มี (mode เริ่มจาก auto_reply ของร้าน) */
export async function ensureConversation(
  shopId: string,
  customerId: string,
  channel: string,
): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM conversations WHERE customer_id = $1 AND channel = $2",
    [customerId, channel],
  );
  if (existing) return existing.id;
  // กันแชตหาย: ลูกค้าทักในแอปที่ยังไม่เพิ่ม → เพิ่มแอปอัตโนมัติ (โหมด off)
  await addInboxApp(shopId, channel);
  // โหมดของบทสนทนาใหม่ยึดตามโหมด AI ของ "แอป" นั้น (off = manual, อื่นๆ = auto)
  const level = await getChannelLevel(shopId, channel);
  const mode = level === "off" ? "manual" : "auto";
  const id = newId();
  const now = Date.now();
  await query(
    `INSERT INTO conversations (id, shop_id, customer_id, channel, mode, last_message_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, shopId, customerId, channel, mode, now],
  );
  return id;
}

/** เพิ่มข้อความ + เด้ง last_message_at (extId = id ฝั่ง LINE ไว้กันซ้ำ) */
export async function addMessage(
  conversationId: string,
  sender: "customer" | "admin",
  text: string,
  extId?: string,
  media?: { kind: "text" | "image"; imageUrl?: string; blobKey?: string },
  createdAt?: number, // เวลาส่งจริง (เช่น Lazada send_time) — ไม่ระบุ = ตอนนี้; ใช้เรียงลำดับให้ตรง
): Promise<ChatMessage> {
  const id = newId();
  const now = createdAt && Number.isFinite(createdAt) ? createdAt : Date.now();
  const kind = media?.kind ?? "text";
  const imageUrl = media?.imageUrl ?? null;
  const blobKey = media?.blobKey ?? null;
  await query(
    `INSERT INTO messages (id, conversation_id, sender, text, created_at, ext_id, kind, image_url, blob_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, conversationId, sender, text, now, extId ?? null, kind, imageUrl, blobKey],
  );
  await query("UPDATE conversations SET last_message_at = $1 WHERE id = $2", [
    now,
    conversationId,
  ]);
  await trimConversation(conversationId);
  return {
    id,
    sender,
    text,
    createdAt: now,
    kind,
    imageUrl: imageUrl ?? undefined,
    blobKey: blobKey ?? undefined,
  };
}

/** เคลมสิทธิ์ดึงประวัติ (atomic): คืน true ครั้งแรกครั้งเดียว → กันดึงซ้ำทุกข้อความ */
export async function claimHistorySync(conversationId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    "UPDATE conversations SET history_synced = true WHERE id = $1 AND history_synced = false RETURNING id",
    [conversationId],
  );
  return Boolean(row);
}

/**
 * ใส่ข้อความย้อนหลัง (history จาก IM API) ที่ยังไม่มีในบทสนทนา — dedup ด้วย ext_id, created_at ตามจริง
 * คืนจำนวนที่เพิ่ม; ไม่ trim (ให้ getConversation/รอบ retention จัดการ)
 */
export async function backfillMessages(
  conversationId: string,
  msgs: { sender: "customer" | "admin"; text: string; extId: string; createdAt: number }[],
): Promise<number> {
  let added = 0;
  for (const m of msgs) {
    if (m.extId) {
      const dup = await queryOne<{ id: string }>(
        "SELECT id FROM messages WHERE ext_id = $1",
        [m.extId],
      );
      if (dup) continue;
    }
    await query(
      `INSERT INTO messages (id, conversation_id, sender, text, created_at, ext_id, kind)
       VALUES ($1, $2, $3, $4, $5, $6, 'text')`,
      [newId(), conversationId, m.sender, m.text, m.createdAt, m.extId || null],
    );
    added++;
  }
  if (added) {
    await query(
      `UPDATE conversations SET last_message_at = GREATEST(last_message_at,
         (SELECT COALESCE(MAX(created_at), 0) FROM messages WHERE conversation_id = $1))
       WHERE id = $1`,
      [conversationId],
    );
  }
  return added;
}

/**
 * ลูกค้าทักเข้ามา (ใช้ทั้ง webhook จริงและแชทจำลอง)
 * คืน conversationId หรือ null ถ้า extId ซ้ำ (ประมวลผลไปแล้ว — กัน LINE retry)
 */
export async function ingestCustomerMessage(
  shopId: string,
  opts: {
    channel: string;
    lineUserId: string;
    displayName: string;
    text: string;
    extId?: string;
    kind?: "text" | "image";
    imageUrl?: string;
    blobKey?: string;
    sessionId?: string; // Lazada IM session_id (เก็บไว้ส่งกลับ)
    createdAt?: number; // เวลาส่งจริง (Lazada send_time) — เรียงลำดับให้ตรงกับประวัติ
  },
): Promise<string | null> {
  if (opts.extId) {
    const dup = await queryOne<{ id: string }>(
      "SELECT id FROM messages WHERE ext_id = $1",
      [opts.extId],
    );
    if (dup) return null;
  }
  const customerId = await upsertCustomer(
    shopId,
    opts.channel,
    opts.lineUserId,
    opts.displayName,
    opts.sessionId,
  );
  const conversationId = await ensureConversation(shopId, customerId, opts.channel);
  await addMessage(
    conversationId,
    "customer",
    opts.text,
    opts.extId,
    { kind: opts.kind ?? "text", imageUrl: opts.imageUrl, blobKey: opts.blobKey },
    opts.createdAt,
  );
  return conversationId;
}

/** ตรวจว่าบทสนทนานี้เป็นของร้านนี้จริง */
async function ownsConversation(
  shopId: string,
  conversationId: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM conversations WHERE id = $1 AND shop_id = $2",
    [conversationId, shopId],
  );
  return Boolean(row);
}

/**
 * ข้อความฝั่งร้านที่มาจากแพลตฟอร์ม (เช่น แอดมินตอบจากแอป Lazada เอง / auto-greeting ของร้าน)
 * หา conversation จาก session_id แล้วบันทึกเป็น admin — dedup ด้วย extId (กัน echo ของที่เราส่งเอง)
 * คืน conversationId หรือ null ถ้าซ้ำ/ยังไม่มีบทสนทนา (history sync จะเก็บให้ตอนลูกค้าทักครั้งหน้า)
 */
export async function ingestExternalAdminMessage(
  channel: string,
  sessionId: string,
  opts: { text: string; extId?: string; createdAt?: number },
): Promise<string | null> {
  if (opts.extId) {
    const dup = await queryOne<{ id: string }>(
      "SELECT id FROM messages WHERE ext_id = $1",
      [opts.extId],
    );
    if (dup) return null;
  }
  const row = await queryOne<{ id: string }>(
    `SELECT co.id FROM conversations co
     JOIN customers cu ON cu.id = co.customer_id
     WHERE co.channel = $1 AND cu.ext_session_id = $2`,
    [channel, sessionId],
  );
  if (!row) return null;
  await addMessage(row.id, "admin", opts.text, opts.extId, undefined, opts.createdAt);
  // ร้านตอบเองแล้ว = ไม่ต้องรอคนตอบ
  await query("UPDATE conversations SET pending_human = false WHERE id = $1", [row.id]);
  return row.id;
}

export async function addAdminMessage(
  shopId: string,
  conversationId: string,
  text: string,
  extId?: string, // id ฝั่งแพลตฟอร์ม (เช่น Lazada message_id) — ให้ webhook echo dedup ได้
): Promise<ChatMessage | null> {
  if (!(await ownsConversation(shopId, conversationId))) return null;
  const msg = await addMessage(conversationId, "admin", text, extId);
  await query("UPDATE conversations SET pending_human = false WHERE id = $1", [
    conversationId,
  ]);
  return msg;
}

/** ตั้งสถานะ "รอคนตอบ" (auto ไม่มั่นใจ) */
export async function setPendingHuman(
  conversationId: string,
  value: boolean,
): Promise<void> {
  await query("UPDATE conversations SET pending_human = $1 WHERE id = $2", [
    value,
    conversationId,
  ]);
}

/** โหมดของบทสนทนา ('manual'|'auto') — null ถ้าไม่มี */
export async function getConversationMode(
  conversationId: string,
): Promise<"manual" | "auto" | null> {
  const row = await queryOne<{ mode: string }>(
    "SELECT mode FROM conversations WHERE id = $1",
    [conversationId],
  );
  if (!row) return null;
  return row.mode === "auto" ? "auto" : "manual";
}

export async function listConversations(
  shopId: string,
): Promise<ConversationSummary[]> {
  const rows = await query<{
    id: string;
    customername: string;
    channel: string;
    lasttext: string | null;
    lastsender: string | null;
    last_message_at: string;
    pending_human: boolean;
  }>(
    `SELECT c.id,
            cu.display_name AS customername,
            c.channel,
            c.last_message_at,
            c.pending_human,
            (SELECT m.text   FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lasttext,
            (SELECT m.sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastsender
     FROM conversations c
     JOIN customers cu ON cu.id = c.customer_id
     WHERE c.shop_id = $1
     ORDER BY c.last_message_at DESC`,
    [shopId],
  );
  return rows.map((r) => ({
    id: r.id,
    customerName: r.customername || "ลูกค้า",
    channel: r.channel,
    lastText: r.lasttext ?? "",
    lastMessageAt: Number(r.last_message_at),
    lastSender: (r.lastsender as "customer" | "admin" | null) ?? null,
    pendingHuman: r.pending_human,
  }));
}

export async function getConversation(
  shopId: string,
  conversationId: string,
): Promise<ConversationDetail | null> {
  const head = await queryOne<{
    id: string;
    customername: string;
    channel: string;
    mode: string;
  }>(
    `SELECT c.id, cu.display_name AS customername, c.channel, c.mode
     FROM conversations c
     JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = $1 AND c.shop_id = $2`,
    [conversationId, shopId],
  );
  if (!head) return null;

  const msgs = await query<{
    id: string;
    sender: string;
    text: string;
    created_at: string;
    kind: string;
    image_url: string | null;
    blob_key: string | null;
  }>(
    `SELECT id, sender, text, created_at, kind, image_url, blob_key FROM messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );

  return {
    id: head.id,
    customerName: head.customername || "ลูกค้า",
    channel: head.channel,
    mode: head.mode === "auto" ? "auto" : "manual",
    messages: msgs.map((m) => ({
      id: m.id,
      sender: m.sender === "admin" ? "admin" : "customer",
      text: m.text,
      createdAt: Number(m.created_at),
      kind: m.kind === "image" ? "image" : "text",
      imageUrl: m.image_url ?? undefined,
      blobKey: m.blob_key ?? undefined,
    })),
  };
}

/** ปลายทางสำหรับส่งกลับ (lineUserId) — null ถ้าไม่ใช่ของร้านนี้ */
export async function getSendTarget(
  shopId: string,
  conversationId: string,
): Promise<{ channel: string; lineUserId: string | null; sessionId: string | null } | null> {
  const row = await queryOne<{
    channel: string;
    line_user_id: string | null;
    ext_session_id: string | null;
  }>(
    `SELECT c.channel, cu.line_user_id, cu.ext_session_id
     FROM conversations c
     JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = $1 AND c.shop_id = $2`,
    [conversationId, shopId],
  );
  if (!row) return null;
  return { channel: row.channel, lineUserId: row.line_user_id, sessionId: row.ext_session_id };
}

export async function setMode(
  shopId: string,
  conversationId: string,
  mode: "manual" | "auto",
): Promise<void> {
  await query(
    "UPDATE conversations SET mode = $1 WHERE id = $2 AND shop_id = $3",
    [mode, conversationId, shopId],
  );
}

/** ตั้งโหมดให้ทุกบทสนทนาของร้าน (ใช้ตอนสลับสวิตช์รวมระดับร้าน) */
export async function setAllConversationsMode(
  shopId: string,
  mode: "manual" | "auto",
): Promise<void> {
  await query("UPDATE conversations SET mode = $1 WHERE shop_id = $2", [
    mode,
    shopId,
  ]);
}

/** ตั้งโหมดเฉพาะบทสนทนาของ channel นั้น (ใช้ตอนสลับโหมด AI ของแอปเดียว) */
export async function setChannelConversationsMode(
  shopId: string,
  channel: string,
  mode: "manual" | "auto",
): Promise<void> {
  await query(
    "UPDATE conversations SET mode = $1 WHERE shop_id = $2 AND channel = $3",
    [mode, shopId, channel],
  );
}
