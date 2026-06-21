# ออกแบบ: ระบบเชื่อม LINE OA (ต่อร้าน) — phuang

วันที่: 2026-06-22
สถานะ: รออนุมัติ
ขอบเขตสเปกนี้: **เฉพาะ "ระบบเชื่อม LINE OA"** (รับข้อความเข้า + ส่งกลับ ต่อร้าน)
ส่วนโหมด AI auto-reply / manual-choice = เฟสถัดไป (สเปกแยก)

---

## 1. เป้าหมาย (Goals)

- ให้แต่ละร้านเชื่อม LINE OA ของตัวเองได้ผ่านหน้าเว็บ phuang โดย **วางแค่ 2 ค่า** (Channel secret + Channel access token) + วาง Webhook URL ฝั่ง LINE
- ใช้ **webhook ปลายทางเดียว** รับทุกร้าน แล้วแยกว่าข้อความเข้าร้านไหนจากค่า `destination` (ไอดีบอท)
- เก็บ credential แยกต่อร้านใน DB อย่างปลอดภัย (ไม่ใช้ env รวมอีกต่อไป สำหรับร้านที่เชื่อมผ่านหน้าเว็บ)
- ข้อความที่เข้ามาไหลเข้า "กล่องแชต" เดิมของร้านนั้น และตอบกลับออก LINE ได้

## 2. ไม่ทำในสเปกนี้ (Non-goals)

- โหมด AI ตอบอัตโนมัติ + ประเมินความมั่นใจ + เด้งถามคน (เฟส 2)
- โหมด manual ที่ AI เสนอ 2-3 choice (เฟส 2)
- รองรับข้อความที่ไม่ใช่ text (รูป/สติกเกอร์) — เฟสถัดไป
- หลาย channel ต่อ 1 ร้าน (ตอนนี้ 1 ร้าน = 1 LINE OA)

## 3. โมเดลข้อมูล (DB)

ตารางใหม่ `line_channels` (1 ร้าน 1 channel):

| คอลัมน์ | ชนิด | หมายเหตุ |
|---------|------|----------|
| id | TEXT PK | |
| shop_id | TEXT FK→shops ON DELETE CASCADE, UNIQUE | 1 ร้าน 1 channel |
| channel_secret | TEXT | ใช้ verify ลายเซ็น webhook |
| access_token | TEXT | ใช้ส่งข้อความออก (long-lived) |
| bot_user_id | TEXT, UNIQUE | = ค่า `destination` ใน webhook → ใช้ map กลับมาที่ร้าน |
| bot_basic_id | TEXT | เช่น @abc (ไว้โชว์) |
| display_name | TEXT | ชื่อ OA (ไว้โชว์) |
| created_at / updated_at | BIGINT | |

ใช้ตาราง `customers / conversations / messages` เดิม (มีอยู่แล้ว) — ไม่เปลี่ยน

## 4. ส่วนประกอบ (Components)

### 4.1 lib/lineClient.ts (ปรับ)
ปัจจุบันอ่าน credential จาก env (ร้านเดียว) → เปลี่ยนให้ฟังก์ชัน**รับ secret/token เป็นพารามิเตอร์** (ต่อร้าน):
- `verifySignature(rawBody, signature, channelSecret)`
- `pushMessage(accessToken, lineUserId, text)`
- `fetchBotInfo(accessToken)` → `{ userId, basicId, displayName }` (เรียก `GET /v2/bot/info`) ใช้ตอนเชื่อมเพื่อจำไอดีบอท
- `fetchDisplayName(accessToken, lineUserId)`
- โหมดทดลอง (mock) ยังคงไว้ ถ้าไม่มี token จริง

### 4.2 lib/lineChannelRepo.ts (ใหม่)
- `saveChannel(shopId, {channelSecret, accessToken, botUserId, botBasicId, displayName})` (upsert ต่อ shop)
- `getChannelByShop(shopId)`
- `getChannelByBotUserId(botUserId)` → ใช้ใน webhook map ข้อความเข้าร้าน
- `deleteChannel(shopId)`

### 4.3 API routes (auth = แอดมินร้าน ยกเว้น webhook)
- `POST /api/line/connect` — รับ `{channelSecret, accessToken}` → เรียก `fetchBotInfo` ตรวจ token จริง → ถ้าผ่าน `saveChannel` → คืนสถานะ; ถ้า token ผิด คืน error ชัดเจน
  - **โหมดทดลอง (mock):** ถ้า token ขึ้นต้นด้วย `mock-` → ข้ามการเรียก LINE จริง, สร้าง botUserId จำลอง (เช่น `mock-bot-<hash>`) เพื่อให้ทดสอบ flow เชื่อม→รับ→ส่ง ได้ครบโดยไม่ต้องมี OA จริง (เหมือนแนวทาง Lazada/Shopee)
- `GET  /api/line/connect/status` — คืนสถานะเชื่อม (เชื่อมแล้ว/ยัง, ชื่อ OA, basicId, webhook URL ที่ต้องเอาไปวาง)
- `POST /api/line/connect/disconnect` — ลบ channel ของร้าน
- `POST /api/line/webhook` (ปรับ) — ไม่ต้อง login:
  1. อ่าน raw body + header `x-line-signature`
  2. อ่าน `destination` จาก payload → `getChannelByBotUserId(destination)` → ได้ร้าน + secret + token
  3. `verifySignature(raw, sig, channelSecret)` ของร้านนั้น — ไม่ผ่าน → 401
  4. parse text message events → `ingestCustomerMessage(shopId, ...)` (ดึงชื่อโปรไฟล์ด้วย token ร้านนั้น)
  5. คืน 200 เสมอเมื่อผ่าน verify
  - Fallback: ถ้าหา channel จาก destination ไม่เจอ → ลองใช้ env เดิม (ความเข้ากันได้ย้อนหลัง) แล้วค่อยเลิกใช้ภายหลัง
- `POST /api/line/send` (ปรับ) — ใช้ token ของร้านนั้น (จาก `getChannelByShop`) แทน env

### 4.4 UI: หน้า "เชื่อม LINE"
- เพิ่มเป็น **กล่องในหน้า "ตั้งค่าร้าน" (SettingsView)** แบบ **wizard ทีละขั้น**:
  1. โชว์ **Webhook URL** (ปุ่มคัดลอก) ให้เอาไปวางในคอนโซล LINE
  2. ช่องวาง **Channel secret** + **Channel access token** + ปุ่ม "เชื่อม"
  3. เชื่อมสำเร็จ → โชว์ชื่อ OA + สถานะ "เชื่อมแล้ว" + ปุ่มยกเลิกเชื่อม
  4. ลิงก์/คำอธิบายสั้นๆ ว่าแต่ละค่าหาได้ที่ไหน (+ เตือนปิด auto-reply ของ OA)
- รูปแบบ/ธีมเหมือนกล่องเชื่อม Lazada/Shopee เดิม

## 5. โฟลว์ข้อมูล

**เชื่อม:** ร้านวาง secret+token → `/api/line/connect` → `fetchBotInfo` → เก็บ `line_channels` (จำ botUserId)

**รับข้อความ:** ลูกค้าทัก → LINE → `/api/line/webhook` (destination=botUserId) → หา shop → verify ด้วย secret ร้าน → `ingestCustomerMessage` → โผล่ในกล่องแชตร้านนั้น

**ส่งกลับ:** แอดมินกดส่งในกล่องแชต → `/api/line/send` → ใช้ token ร้านนั้น → Push เข้า LINE ลูกค้า

## 6. ความปลอดภัย

- verify `x-line-signature` ทุก request เข้า webhook ด้วย secret **ของร้านนั้น** — ไม่ผ่าน = 401
- credential เก็บใน DB ฝั่ง server เท่านั้น ไม่ส่งกลับ frontend (status คืนแค่ชื่อ OA/basicId/สถานะ)
- ทุก endpoint (ยกเว้น webhook) ต้อง login + ใช้ shopId จากผู้ใช้ ไม่รับ shopId จาก client
- webhook คืน 200 เร็ว กัน LINE retry

## 7. Acceptance checks

1. วาง token ผิด → `/api/line/connect` คืน error ไม่บันทึก
2. วาง token ถูก → เชื่อมสำเร็จ เก็บ botUserId, สถานะขึ้น "เชื่อมแล้ว" + ชื่อ OA
3. ยิง webhook (จำลอง) ด้วย destination ของร้าน + ลายเซ็นถูก → ข้อความโผล่ในกล่องแชตร้านนั้น
4. ยิง webhook ลายเซ็นผิด → 401 ไม่บันทึก
5. ยิง webhook destination ที่ไม่มีร้าน → ไม่ล้ม (200 หรือ fallback) ไม่บันทึกผิดร้าน
6. กดส่งในกล่องแชต → ส่งผ่าน token ร้านนั้น (โหมด mock = ไม่ยิงจริง), บันทึก sender=admin
7. ยกเลิกเชื่อม → ลบ channel, สถานะกลับเป็น "ยังไม่เชื่อม"
8. แยกร้าน: 2 ร้านเชื่อม 2 OA → ข้อความแต่ละ OA เข้าร้านถูกตัว (ทดสอบด้วยร้านทดสอบ ไม่แตะข้อมูลจริง)

## 8. แผนการทำ (ลำดับ)

1. DB: ตาราง `line_channels` + `lineChannelRepo`
2. ปรับ `lineClient` ให้รับ credential ต่อร้าน + `fetchBotInfo`
3. routes: connect / status / disconnect
4. ปรับ webhook ให้ route ตาม destination + verify ต่อร้าน
5. ปรับ `/api/line/send` ใช้ token ต่อร้าน
6. UI: หน้า/กล่อง "เชื่อม LINE" (wizard)
7. ทดสอบตาม Acceptance (ร้านทดสอบ) → commit → push
