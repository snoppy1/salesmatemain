# ระบบแชต: Retention + เก็บรูป + AI วิเคราะห์รูป — Design Spec

วันที่: 2026-06-24

## เป้าหมาย (Goal)

แก้ปัญหา "กลัว database เต็ม" และเพิ่มความสามารถเก็บ/แสดงรูปจากลูกค้าทุกแพลตฟอร์ม โดย AI ดูรูปแล้วตอบได้ — ประกอบด้วย 3 ส่วนที่ใช้สคีมา `messages` ร่วมกัน:

1. **Retention** — กันข้อมูลบวม (ตัดข้อความเก่า + ลบบทสนทนาที่ตายแล้ว + ลบไฟล์รูปที่หมดอายุ)
2. **เก็บรูป** — รับรูปจากลูกค้าทุกช่องทาง (เก็บลิงก์ CDN ของแพลตฟอร์ม; LINE โฮสต์เองบน Vercel Blob)
3. **AI วิเคราะห์รูป** — ส่งรูปเข้า Claude (เฉพาะตอนแชตมีรูป) เพื่อให้ตอบจากภาพได้

## สถาปัตยกรรมโดยรวม (Architecture)

ต่อยอดจากของเดิม (Next.js 16 App Router + Neon Postgres ผ่าน `pg`, channel-aware `processAutoReply`, ตอบด้วย `claude-sonnet-4-6`). ทุกแพลตฟอร์ม (line/facebook/tiktok/lazada/shopee) ลงข้อความผ่าน `ingestCustomerMessage`/`addMessage` ใน `lib/inboxRepo.ts` อยู่แล้ว — งานนี้ขยายให้รองรับ "ข้อความชนิดรูป" + ระบบลบของเก่า + ส่งรูปเข้า Claude. การเก็บรูปแยกตามความสามารถของแต่ละแพลตฟอร์ม (บางเจ้าให้ลิงก์ตรง บาง LINE ต้องโหลดมาโฮสต์เอง). การลบของเก่าทำ 2 จังหวะ: ตัดข้อความตอน insert (ทันที) + ลบบทสนทนาเก่า/ไฟล์หมดอายุผ่าน Vercel Cron (วันละครั้ง).

## Global Constraints

- ปรับสคีมาผ่าน `ensureSchema()` ใน `lib/db.ts` แบบ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (idempotent ตามแพตเทิร์นเดิม)
- ทดสอบ write op ด้วยร้าน throwaway prefix `mkt_` แล้วลบด้วย `scripts/clean-test.mjs` เท่านั้น — ห้ามแตะข้อมูลจริง
- ไม่เปลี่ยนโมเดล AI ของร้าน (คง `claude-sonnet-4-6` ซึ่งรองรับ vision อยู่แล้ว)
- ตัวเลข retention เป็นค่าคงที่ปรับได้ที่เดียว (config object) — ค่าเริ่มต้น: เก็บ 50 ข้อความ/บทสนทนา, ลบบทสนทนาเงียบเกิน 12 เดือน, ลบไฟล์รูปที่เราโฮสต์เกิน 60 วัน

## สคีมา (Schema changes)

ตาราง `messages` (เดิม: id, conversation_id, sender, text, created_at, ext_id) เพิ่ม:

```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';   -- 'text' | 'image'
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;                        -- URL รูป (CDN แพลตฟอร์ม หรือ Vercel Blob)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS blob_key TEXT;                         -- key ของไฟล์ที่เราโฮสต์ (LINE) — ไว้ลบ; null ถ้าใช้ลิงก์ตรง
```

- ข้อความปกติ: `kind='text'`, `image_url=null`, `blob_key=null` (ค่าเดิมไม่กระทบ)
- ข้อความรูป: `kind='image'`, `image_url` มีค่า, `text` เก็บแคปชัน (ว่างได้)
- รูปที่เราโฮสต์เอง (LINE): `blob_key` ไม่ null → ใช้ตอน cleanup ลบไฟล์ออกจาก Blob
- ดัชนีช่วย cleanup: `CREATE INDEX IF NOT EXISTS idx_messages_blob ON messages(blob_key) WHERE blob_key IS NOT NULL;`

## ส่วนที่ 1 — Retention

**ไฟล์:** `lib/retentionRepo.ts` (ใหม่), `lib/inboxRepo.ts` (แก้), `lib/blobStore.ts` (ใหม่, ดูส่วน 2), `app/api/cron/retention/route.ts` (ใหม่), `vercel.json` (แก้), `lib/config.ts` (ใหม่ หรือค่าคงที่ใน retentionRepo)

ค่าคงที่ (config):
```ts
export const RETENTION = {
  keepMessagesPerConversation: 50,
  purgeConversationsAfterDays: 365,
  deleteHostedImagesAfterDays: 60,
};
```

**(ก) ตัดข้อความเกิน 50 ตอนมีข้อความใหม่** — หลัง `addMessage`/`ingestCustomerMessage`/`addAdminMessage` insert สำเร็จ เรียก `trimConversation(conversationId)`:
- หา id ของข้อความที่ "เกินกว่า 50 ตัวล่าสุด" ในบทสนทนานั้น
- ถ้าข้อความที่จะลบมี `blob_key` → เก็บ key ไว้ แล้วเรียก `blobStore.del(keys)` ลบไฟล์ (best-effort, ไม่ throw)
- `DELETE FROM messages WHERE id = ANY($ids)`
- รันแบบ best-effort (try/catch ไม่ให้กระทบ flow รับข้อความ)

**(ข) ลบบทสนทนาเงียบนาน + ไฟล์หมดอายุ (Vercel Cron วันละครั้ง)** — `app/api/cron/retention/route.ts`:
- ตรวจ secret: header `authorization === 'Bearer ' + CRON_SECRET` (กันคนนอกยิง); ตอบ 401 ถ้าไม่ตรง
- `purgeOldConversations()`: หา conversation ที่ `last_message_at < now - 365d` → เก็บ blob_key ของ messages ในนั้น → `blobStore.del` → `DELETE FROM conversations WHERE id = ANY(...)` (cascade ลบ messages ตาม FK เดิม)
- `expireOldImages()`: หา messages ที่ `kind='image' AND blob_key IS NOT NULL AND created_at < now - 60d` → `blobStore.del(keys)` → `UPDATE messages SET image_url=NULL, blob_key=NULL, kind='text', text='🖼️ รูป (หมดอายุ)' WHERE id = ANY(...)` (เก็บแถวไว้เป็นป้าย)
- คืน JSON สรุปจำนวนที่ลบ

`vercel.json` เพิ่ม:
```json
"crons": [{ "path": "/api/cron/retention", "schedule": "0 19 * * *" }]
```
(19:00 UTC = 02:00 ไทย — ช่วงคนน้อย)

## ส่วนที่ 2 — เก็บรูปทุกแพลตฟอร์ม

**ไฟล์:** `lib/blobStore.ts` (ใหม่), `lib/inboxRepo.ts` (แก้ ingest ให้รับ image), webhook ของแต่ละแพลตฟอร์ม (แก้), `lib/lineClient.ts` (เพิ่ม getMessageContent), `lib/types.ts` (แก้ Message type), UI inbox (`app/InboxView.tsx` แสดง thumbnail)

**`lib/blobStore.ts`** — หุ้ม `@vercel/blob`:
- `isBlobConfigured(): boolean` → `Boolean(process.env.BLOB_READ_WRITE_TOKEN)`
- `put(buffer, contentType): Promise<{ url, key }>` → `put(key, buffer, { access:'public', token })`; ถ้าไม่ตั้ง token → throw `BlobNotConfigured`
- `del(keys: string[]): Promise<void>` → best-effort, ไม่ throw

**`ingestCustomerMessage` / `addMessage`** เพิ่มพารามิเตอร์ optional: `kind?: 'text'|'image'`, `imageUrl?: string`, `blobKey?: string` (default 'text') และเขียนลงคอลัมน์ใหม่

**ต่อแพลตฟอร์ม (ในแต่ละ webhook):**
- เมื่อ event เป็นรูป → ดึง/ได้ URL รูป → เรียก `ingestCustomerMessage({..., kind:'image', imageUrl, blobKey})`
- **Facebook / Lazada / Shopee / TikTok**: payload ให้ URL รูปจาก CDN มาเลย → ใช้ `imageUrl=<cdn url>`, `blobKey=null` (ไม่กิน storage เรา)
- **LINE**: ข้อความรูปเป็น `type:'image'` มี `message.id` → เรียก `getMessageContent(token, messageId)` (GET `https://api-data.line.me/v2/bot/message/{id}/content`, header Bearer) ได้ binary → `blobStore.put(buf, contentType)` → `imageUrl=blob.url`, `blobKey=blob.key`
  - ถ้า `isBlobConfigured()===false` → fallback เก็บข้อความ `kind='text', text='🖼️ ลูกค้าส่งรูป (เปิดดูในแอป LINE)'` (ไม่ล่ม)

**UI (`app/InboxView.tsx`)**: ถ้า `msg.kind==='image' && msg.image_url` → แสดง `<img>` thumbnail (คลิกเปิดเต็ม) แทนข้อความ; ถ้าไม่มี url → แสดงป้ายข้อความ

## ส่วนที่ 3 — AI วิเคราะห์รูป

**ไฟล์:** `lib/claude.ts` (แก้), `lib/prompt.ts` (แก้ buildConversationContext ให้คืน image urls ด้วย), `lib/autoReply.ts` + `app/api/line/draft|choices` (ส่ง image urls), `lib/types.ts` (GenerateRequest +imageUrls)

- `GenerateRequest` เพิ่ม `imageUrls?: string[]` — รูปจากข้อความลูกค้าล่าสุด (ภายใน ~3 ข้อความล่าสุด, จำกัดไม่เกิน 4 รูป เพื่อคุมต้นทุน)
- `callClaudeRaw` ใน `lib/claude.ts`: ถ้า `imageUrls` มีค่า → เปลี่ยน `messages[0].content` จาก string เป็น array of content blocks:
  ```
  content: [
    { type: "text", text: userContent },
    { type: "image", source: { type: "url", url: <each public url> } },
    ...
  ]
  ```
  ถ้าไม่มีรูป → คงเป็น string เดิม (ไม่มีต้นทุนรูปเพิ่ม)
- รูปต้องเป็น **URL สาธารณะ** (Vercel Blob public หรือ CDN แพลตฟอร์ม) — Anthropic จะดึงเอง; รูปแบบรองรับ JPEG/PNG/GIF/WebP
- โมเดลคง `claude-sonnet-4-6` (รองรับ vision); ปรับ system prompt #5 เล็กน้อยให้ "ถ้ามีรูป ให้ดูรูปแล้วตอบ เช่น บอกว่าน่าจะเป็นรุ่นไหน/สีอะไร แต่ห้ามมั่วสเปกที่ไม่เห็น"
- `est` cost: รูป 1 ใบ ≈ ~1,600 tokens — ส่งเฉพาะตอนแชตมีรูปจริง

## กัน storage บวม (สรุปกลไก 3 ชั้น)

1. **ตัดข้อความ >50/บทสนทนา** ตอน insert → ลบไฟล์ Blob ของข้อความที่ถูกตัด
2. **ลบบทสนทนาเงียบ >12 เดือน** (cron) → ลบไฟล์ Blob ทั้งหมดในนั้น
3. **ลบไฟล์รูปที่เราโฮสต์ >60 วัน** (cron) → ลบไฟล์ เหลือป้าย "🖼️ รูป (หมดอายุ)"

> รูปจาก Facebook/Lazada/Shopee/TikTok เก็บแค่ลิงก์ CDN (ไม่กิน Blob เรา); มีแต่รูป LINE ที่ขึ้น Blob → ปริมาณ Blob ถูกจำกัดด้วยกลไกข้างบน

## Dependencies ใหม่

- `@vercel/blob` (npm) + env `BLOB_READ_WRITE_TOKEN` — โฮสต์รูป LINE (free tier ~1GB). ถ้าไม่ตั้ง → LINE แสดงป้ายแทนรูป (ระบบไม่ล่ม)
- **Vercel Cron** (ตั้งใน `vercel.json`) + env `CRON_SECRET` — รัน retention วันละครั้ง
- เพิ่ม env ทั้งสองใน `.env.local.example` พร้อมคอมเมนต์

## Error handling

- Blob ใช้ไม่ได้ตอนรับรูป LINE → fallback ป้ายข้อความ ไม่ทำให้ webhook ล่ม
- `trimConversation` / cleanup ล้มเหลว → try/catch เงียบ ไม่กระทบการรับ/ตอบข้อความ
- Cron ถูกยิงโดยไม่มี secret → 401
- รูปดึงเข้า Claude ไม่ได้ (เช่น url ตาย) → Anthropic ตอบ error; จับใน callClaudeRaw แล้ว fallback ส่งเฉพาะ text (retry แบบไม่มีรูป)

## Testing (mock-first, throwaway `mkt_`)

- **Schema migrate**: รัน ensureSchema แล้วเช็คคอลัมน์ใหม่มีจริง
- **เก็บรูป**: ยิง simulate ข้อความรูป (mock image url) ต่อแพลตฟอร์ม → GET conversation เห็น `kind='image'`, `image_url`
- **AI vision**: simulate ลูกค้าส่งรูปสินค้า (ใช้ url รูปสาธารณะจริง) → draft → ยืนยัน AI อ้างถึงรูปได้ (เช่น บอกสี/ลักษณะ)
- **Trim 50**: ยิง 55 ข้อความ → เหลือ 50 ล่าสุด; ถ้าข้อความที่ตัดมี blobKey → mock blobStore.del ถูกเรียก
- **Cron retention**: seed บทสนทนา last_message_at เก่า 13 เดือน + รูปเก่า 70 วัน → ยิง /api/cron/retention (พร้อม secret) → บทสนทนาถูกลบ + รูปกลายเป็นป้าย
- ลบร้านทดสอบด้วย `scripts/clean-test.mjs`

## Out of scope (ยังไม่ทำรอบนี้)

- backfill ประวัติเก่าจากแพลตฟอร์ม (LINE ทำไม่ได้อยู่แล้ว)
- รับ media ชนิดอื่น (วิดีโอ/ไฟล์/เสียง) — รอบนี้เอาเฉพาะรูป
- ให้ admin ตั้งค่าตัวเลข retention เองผ่าน UI (รอบนี้เป็นค่าคงที่ในโค้ด)
- ตัด/ย่อรูปก่อนเก็บ (เก็บไฟล์ตามต้นฉบับ; คุมด้วย retention แทน)
