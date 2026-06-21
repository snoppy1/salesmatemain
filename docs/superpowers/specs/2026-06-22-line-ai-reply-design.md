# ออกแบบ: LINE AI ตอบ — auto (มั่นใจ→ส่งเอง / ไม่มั่นใจ→รอคน) + manual choices

วันที่: 2026-06-22
สถานะ: อนุมัติแล้ว (เฟส 2 ต่อจากระบบเชื่อม LINE)

## 1. เป้าหมาย
- **Manual:** ในกล่องแชต AI เสนอ 2-3 คำตอบให้เลือก → กดเลือก → เข้าช่องพิมพ์ → ส่ง
- **Auto:** ลูกค้าทัก → ถ้าแชตเป็น auto → AI ร่าง + ประเมินมั่นใจ → มั่นใจ ส่งเอง (Reply API ฟรี) / ไม่มั่นใจ ไม่ส่ง ทำเครื่องหมาย "รอตอบ"
- **ควบคุม:** สวิตช์ระดับร้าน (default ปิด) + override auto/manual รายแชต

## 2. โมเดลข้อมูล
- `shops` + `auto_reply BOOLEAN NOT NULL DEFAULT false` — ค่าเริ่มต้นของร้าน (ใช้ตอนสร้างบทสนทนาใหม่)
- `conversations.mode` (มีอยู่ 'manual'/'auto') — override รายแชต; ตอนสร้างใหม่ตั้งจาก shop.auto_reply
- `conversations` + `pending_human BOOLEAN NOT NULL DEFAULT false` — auto ไม่มั่นใจ → true (เด้ง "รอตอบ"); admin ส่ง → false
- `messages` + `ext_id TEXT` — เก็บ message id ของ LINE กันประมวลผล/ตอบซ้ำ (idempotency)

## 3. lib
- `prompt.ts`:
  - REPLY: เพิ่มฟิลด์ `needs_human` ใน JSON (auto ใช้ประเมินมั่นใจ)
  - เพิ่ม CHOICES prompt + builder → `{"choices":["...","...","..."]}` (2-3 คำตอบพร้อมส่ง)
- `claude.ts`:
  - `ReplyResult = { message; needsHuman; reason }`; `generateReply(req): Promise<ReplyResult>`
  - `generateChoices(req): Promise<string[]>`
- `lineClient.ts`: เพิ่ม `replyMessage(accessToken, replyToken, text)` (Reply API; mock ถ้า token mock-)
- `inboxRepo.ts`:
  - `ingestCustomerMessage` รับ `extId?`, `replyToken?`; ถ้า extId ซ้ำ → ข้าม (คืน null); `ensureConversation` ตั้ง mode จาก shop.auto_reply
  - `setPendingHuman(conversationId, bool)`; `getConversationMode(shopId, conversationId)`
  - `listConversations` คืน `pendingHuman` ด้วย; `addAdminMessage` เคลียร์ pending_human=false

## 4. routes
- `POST /api/line/choices` — {conversationId} → {choices:[]} (auth, โหลด shopData + history → generateChoices)
- `POST /api/line/draft` (ปรับ) — ใช้ ReplyResult ใหม่ (message + reason)
- `GET/POST /api/line/automode` — สวิตช์ระดับร้าน (อ่าน/ตั้ง shops.auto_reply)
- `POST /api/line/mode` — {conversationId, mode} ตั้ง override รายแชต (ใช้ setMode เดิม)
- `POST /api/line/webhook` (ปรับ): หลัง ingest → ใช้ `after()` (next/server) ประมวลผล auto นอกการตอบ 200:
  - สำหรับแต่ละข้อความใหม่ในแชต mode=auto → generateReply → needsHuman? setPendingHuman(true) : replyMessage(replyToken) + addAdminMessage + setPendingHuman(false)

## 5. UI (InboxView + SettingsView)
- InboxView:
  - ปุ่ม **"💡 เสนอคำตอบ"** → /api/line/choices → ชิป 2-3 อัน กดแล้วใส่ช่องพิมพ์
  - แทน badge "โหมดกดส่งเอง" เป็น **ปุ่มสลับ auto/manual** (เรียก /api/line/mode)
  - ลิสต์ซ้าย: แชตที่ `pendingHuman` โชว์ป้าย **"รอตอบ"**
- SettingsView (LineConnectBox): สวิตช์ **"ให้ AI ตอบเองอัตโนมัติ (auto)"** (เรียก /api/line/automode) — โชว์เมื่อเชื่อม LINE แล้ว

## 6. ความปลอดภัย/ขอบเขต
- auto ส่งเองเฉพาะ needs_human=false; ที่เหลือรอคน
- dedupe ด้วย ext_id กันตอบซ้ำตอน LINE retry
- ปิด auto ได้ทุกเมื่อ (สวิตช์ร้าน/รายแชต)
- mock-first: token mock- → replyMessage ไม่ยิงจริง, ทดสอบ flow ได้

## 7. Acceptance
1. manual: /api/line/choices คืน 2-3 คำตอบ
2. auto + มั่นใจ (mock): webhook → มี admin message ตอบกลับอัตโนมัติ, pending_human=false
3. auto + ไม่มั่นใจ: ไม่มี admin message, pending_human=true, ลิสต์โชว์ "รอตอบ"
4. ext_id ซ้ำ → ไม่ ingest/ตอบซ้ำ
5. สวิตช์ร้าน on → บทสนทนาใหม่ mode=auto; override รายแชตได้
6. ทดสอบด้วยร้านทดสอบ (mkt_) แล้วลบ

## 8. ลำดับการทำ
1. DB (auto_reply, pending_human, ext_id) + ปรับ inboxRepo
2. prompt + claude (needs_human, choices, ReplyResult)
3. lineClient.replyMessage
4. routes: choices, automode, mode, ปรับ draft
5. webhook auto (after())
6. UI: choices chips, mode toggle, pending badge, shop switch
7. smoke test (mock) + push
