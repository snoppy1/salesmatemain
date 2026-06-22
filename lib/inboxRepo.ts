import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";
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
    return existing.id;
  }
  const id = newId();
  await query(
    `INSERT INTO customers (id, shop_id, channel, line_user_id, display_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, shopId, channel, lineUserId, displayName, Date.now()],
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
  const shop = await queryOne<{ auto_reply: boolean }>(
    "SELECT auto_reply FROM shops WHERE id = $1",
    [shopId],
  );
  const mode = shop?.auto_reply ? "auto" : "manual";
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
): Promise<ChatMessage> {
  const id = newId();
  const now = Date.now();
  await query(
    `INSERT INTO messages (id, conversation_id, sender, text, created_at, ext_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, conversationId, sender, text, now, extId ?? null],
  );
  await query("UPDATE conversations SET last_message_at = $1 WHERE id = $2", [
    now,
    conversationId,
  ]);
  return { id, sender, text, createdAt: now };
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
  );
  const conversationId = await ensureConversation(shopId, customerId, opts.channel);
  await addMessage(conversationId, "customer", opts.text, opts.extId);
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

export async function addAdminMessage(
  shopId: string,
  conversationId: string,
  text: string,
): Promise<ChatMessage | null> {
  if (!(await ownsConversation(shopId, conversationId))) return null;
  const msg = await addMessage(conversationId, "admin", text);
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
  }>(
    `SELECT id, sender, text, created_at FROM messages
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
    })),
  };
}

/** ปลายทางสำหรับส่งกลับ (lineUserId) — null ถ้าไม่ใช่ของร้านนี้ */
export async function getSendTarget(
  shopId: string,
  conversationId: string,
): Promise<{ channel: string; lineUserId: string | null } | null> {
  const row = await queryOne<{ channel: string; line_user_id: string | null }>(
    `SELECT c.channel, cu.line_user_id
     FROM conversations c
     JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = $1 AND c.shop_id = $2`,
    [conversationId, shopId],
  );
  if (!row) return null;
  return { channel: row.channel, lineUserId: row.line_user_id };
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
