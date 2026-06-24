# กล่องแชตแบบลิสต์แอป + โหมด AI แยกต่อแอป — Design Spec

**วันที่:** 2026-06-24
**สถานะ:** อนุมัติแล้ว (รอ implement)

## เป้าหมาย (Goal)
เปลี่ยนหน้ารวมกล่องแชตจาก "การ์ดตาราง 5 แอปเสมอ + โหมด AI ระดับร้านตัวเดียว" เป็น **ลิสต์แนวตั้งของแอปที่ผู้ใช้เพิ่มเอง** โดย **โหมด AI แยกอิสระต่อแอป** (เปลี่ยนแอปหนึ่งไม่กระทบแอปอื่น)

## ปัญหาปัจจุบัน
- หน้ารวม (`PlatformHub` ใน `app/InboxView.tsx`) โชว์ทั้ง 5 แพลตฟอร์มเสมอ ไม่ว่าจะใช้จริงหรือไม่
- โหมด AI (`auto_level`: off/safe/full) เป็น **ระดับร้าน** เก็บใน `shops.auto_level` — เปลี่ยนที่แอปไหนก็เปลี่ยนหมด (`/api/line/automode` → `setAllConversationsMode`)

## สถาปัตยกรรม (Architecture)
แยกเป็น 3 ชั้น:
1. **ชั้นข้อมูล** — ตารางใหม่ `inbox_apps` เก็บ "แอปที่ร้านเพิ่ม" + โหมด AI ต่อแอป
2. **ชั้น AI/พฤติกรรม** — `ensureConversation` และ `processAutoReply` อ่านโหมดจาก "แอป" (channel) แทน "ร้าน"
3. **ชั้น UI** — `InboxView` หน้ารวมเป็นลิสต์การ์ดแนวตั้งของแอปที่เพิ่ม + ปุ่มเพิ่ม/ลบ + เลือกโหมดต่อแอป

## ชั้นข้อมูล (Data Model)

ตารางใหม่ (migrate ใน `ensureSchema()` ที่ `lib/db.ts` ด้วย `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS inbox_apps (
  shop_id    TEXT NOT NULL,
  channel    TEXT NOT NULL,
  auto_level TEXT NOT NULL DEFAULT 'off',
  sort_order INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, channel)
);
```

- 1 แถว = 1 แอปที่ร้านเพิ่มเข้ากล่องแชต
- `auto_level` ∈ {`off`,`safe`,`full`} — โหมด AI ของแอปนั้น (default `off` = ✋ กดส่งเอง)
- `sort_order` — ลำดับในลิสต์ (เพิ่มทีหลังอยู่ล่าง)
- ร้านใหม่ = ไม่มีแถว = ลิสต์ว่าง

ฟังก์ชันใหม่ (ไฟล์ใหม่ `lib/inboxAppsRepo.ts`):
- `listInboxApps(shopId): Promise<{channel: string; level: AutoLevel; sortOrder: number}[]>` — เรียงตาม sort_order
- `addInboxApp(shopId, channel): Promise<void>` — เพิ่มแอป (default level 'off', sort_order = max+1); ถ้ามีแล้วไม่ทำซ้ำ (`ON CONFLICT DO NOTHING`)
- `removeInboxApp(shopId, channel): Promise<void>` — ลบแถว (ไม่แตะ conversations/channel ที่เชื่อม)
- `ensureInboxApp(shopId, channel): Promise<void>` — เหมือน addInboxApp แต่ใช้ภายในตอนรับข้อความ (กันแชตหาย)
- `getChannelLevel(shopId, channel): Promise<AutoLevel>` — คืน level ของแอป; ถ้าไม่มีแถว → 'off'
- `setChannelLevel(shopId, channel, level): Promise<void>` — ตั้ง level (upsert แถวถ้ายังไม่มี)

## ชั้น AI/พฤติกรรม (Behavior)

**การ map level → conversation.mode** (คงคอนเซ็ปต์เดิม): `off` → `manual`, `safe`/`full` → `auto`

1. **`ensureConversation` (`lib/inboxRepo.ts`)** — แชตใหม่ของ channel C:
   - เรียก `ensureInboxApp(shopId, C)` ก่อน (กันแชตหาย: แอปที่ยังไม่เพิ่มจะถูกเพิ่มอัตโนมัติ default off)
   - `mode` = `getChannelLevel(shopId, C) === 'off' ? 'manual' : 'auto'` (แทนการอ่าน `shops.auto_reply`)

2. **`processAutoReply` (`lib/autoReply.ts`)** — เปลี่ยน `getAutoLevel(shopId)` → `getChannelLevel(shopId, convo.channel)` สำหรับตัดสิน `fullNow`

3. **เปลี่ยนโหมดของแอป** (endpoint ใหม่) — ตั้ง `setChannelLevel` + อัปเดต mode ของ "เฉพาะ conversations ของ channel นั้น":
   - ฟังก์ชันใหม่ `setChannelConversationsMode(shopId, channel, mode)` ใน `inboxRepo.ts` (เหมือน `setAllConversationsMode` แต่ `WHERE channel = $`)
   - ถ้าเปิด AI (≠ off) → ตอบข้อความลูกค้าที่ค้างไว้ของ channel นั้น (ข้อความล่าสุดเป็นของลูกค้า) ผ่าน `after()` + `processAutoReply` (เหมือน `/api/line/automode` เดิม แต่ filter เฉพาะ channel)

ของเดิม `shops.auto_level`/`auto_reply` และ `/api/line/automode` — **คงไว้ ไม่ลบ** (กันพังส่วนอื่น) แต่กล่องแชตใหม่ไม่ใช้แล้ว ใช้ per-channel แทน

## ชั้น API
ไฟล์ใหม่ `app/api/inbox/apps/route.ts`:
- `GET` → `{ apps: {channel, level}[] }` จาก `listInboxApps` (auth: ต้อง login; ใช้ `admin.shopId`)
- `POST {channel}` → ตรวจ channel ถูกต้อง (อยู่ใน 5 แพลตฟอร์ม) แล้ว `addInboxApp` → คืนลิสต์ใหม่
- `DELETE ?channel=` → `removeInboxApp` → คืนลิสต์ใหม่

ไฟล์ใหม่ `app/api/inbox/apps/level/route.ts`:
- `POST {channel, level}` → validate → `setChannelLevel` + `setChannelConversationsMode` + (ถ้า ≠ off) ตอบแชตค้างของ channel นั้น → คืน `{channel, level}`

(วาง endpoint ใต้ `/api/inbox/` เพื่อสื่อว่าเป็นของกล่องแชตรวม ไม่ผูกกับ LINE)

## ชั้น UI (`app/InboxView.tsx`)

**หน้ารวม (`PlatformHub` → เขียนใหม่เป็น `AppList`)**
- โหลด `GET /api/inbox/apps` → ลิสต์แอปที่เพิ่ม (channel + level)
- รวมกับ `conversations` (มีอยู่แล้ว) เพื่อนับ `pending` (รอตอบ) ต่อ channel ฝั่ง client
- การ์ดแต่ละแอป (2 บรรทัด):
  - บรรทัด 1: ไอคอน (`PLATFORMS[].Glyph`/`iconBg`) + ชื่อ + badge `🔴 รอตอบ N` (ถ้า N>0)
  - บรรทัด 2: `โหมด AI:` + `<select>` (off/safe/full) → `POST /api/inbox/apps/level` (มี confirm ตอนเลือก full เหมือนเดิม)
  - ปุ่ม `✕` มุมการ์ด (hover) → ยืนยัน → `DELETE` ออกจากลิสต์
  - กดที่ตัวการ์ด (ไม่ใช่ที่ select/✕) → `onPick(channel)` เข้าหน้าแชตของแอปนั้น (เหมือนเดิม)
- ใต้ลิสต์: ปุ่ม `➕ เพิ่มแอป` → เมนูเลือกจากแอปที่ "ยังไม่ได้เพิ่ม" → `POST` แล้วโผล่ในลิสต์
- ร้านใหม่ (ลิสต์ว่าง): โชว์เฉพาะ `➕ เพิ่มแอป` กลางพื้นที่

**หน้าแชตของแต่ละแอป (ส่วน return หลัก)**
- `<select>` โหมด AI ที่ header (เดิมยิง `/api/line/automode`) → เปลี่ยนเป็นยิง `/api/inbox/apps/level` ของ channel ที่เปิดอยู่ (ค่าซิงค์กับการ์ดในหน้ารวม)
- ลบ state `autoLevel` ระดับร้าน → ใช้ level ต่อ channel (เก็บใน map `levelByChannel` หรือดึงจากลิสต์ apps)

## Error handling
- เพิ่มแอปซ้ำ → `ON CONFLICT DO NOTHING` (ไม่ error)
- channel ไม่ถูกต้อง → API ตอบ 400
- ลบแอปที่ไม่มี → no-op
- โหลด `/api/inbox/apps` ล้มเหลว → ลิสต์ว่าง (เงียบ เหมือน pattern เดิม)

## Testing
TDD ชั้นข้อมูล (สคริปต์ node ชั่วคราวยิง pg จริงบนร้าน `mkt_` โยนทิ้ง ตาม pattern เดิม — ไม่แตะข้อมูลจริง):
1. `addInboxApp` แล้ว `listInboxApps` คืนแอปนั้น level 'off'
2. `setChannelLevel('safe')` แล้ว `getChannelLevel` = 'safe'
3. `addInboxApp` ซ้ำ → ไม่เพิ่มแถวซ้ำ
4. `removeInboxApp` → หายจากลิสต์
5. แชตใหม่ใน channel ที่ level 'off' → mode 'manual'; channel level 'safe' → mode 'auto'
6. เปลี่ยน level แอป A ไม่กระทบ mode ของ channel B (independence)
7. รับข้อความใน channel ที่ยังไม่ได้เพิ่ม → `ensureInboxApp` เพิ่มให้อัตโนมัติ
- ทดสอบ `npx tsc --noEmit` + `npx next build` ผ่าน
- ทดสอบ UI ด้วยตา (build + กดจริงในแอป)

## ไม่กระทบของเดิม
- ฟีเจอร์รับรูป / รอคำถามหลังรูป / retention / draft / choices / send — ไม่แตะ
- `shops.auto_level` / `/api/line/automode` คงไว้ (legacy) เผื่อส่วนอื่นเรียก

## YAGNI (ไม่ทำตอนนี้)
- override โหมดราย "บทสนทนา" (per-conversation) — ใช้ระดับแอปพอ
- ลาก-จัดเรียงลำดับแอป (sort_order ใช้ตามลำดับเพิ่ม)
