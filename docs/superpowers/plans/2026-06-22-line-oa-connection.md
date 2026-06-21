# LINE OA Connection — Implementation Plan

> **For agentic workers:** ทำทีละ Task ตามลำดับ แต่ละ Task จบด้วยการตรวจ (typecheck/build/smoke test) + commit

**Goal:** ให้แต่ละร้านเชื่อม LINE OA ของตัวเองผ่านหน้าเว็บ (วาง secret+token) แล้วรับ/ส่งข้อความผ่าน webhook เดียวที่ route ตามไอดีบอท

**Architecture:** เก็บ credential ต่อร้านในตาราง `line_channels`, webhook เดียวอ่าน `destination`→หาร้าน→verify ด้วย secret ร้านนั้น→เข้ากล่องแชตเดิม; ส่งออกใช้ token ร้านนั้น แทนระบบ env เดิม

**Tech Stack:** Next.js 16 App Router, pg (Postgres/Neon), TypeScript, Tailwind

## Global Constraints

- ไม่มี unit test framework — ตรวจด้วย `npx tsc --noEmit`, `npm run build`, และ smoke test ผ่าน dev server (port 3210) กับร้านทดสอบ (username ขึ้นต้น `mkt_`) แล้วลบด้วย `scripts/clean-test.mjs`
- ห้ามทดสอบ write บนข้อมูลจริง — ใช้ร้านทดสอบเท่านั้น (มีใน memory)
- mock-first: token ขึ้นต้น `mock-` = ไม่ยิง LINE จริง
- ทุก endpoint (ยกเว้น webhook) ต้อง login, ใช้ shopId จาก session
- commit message ลงท้าย `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (ใช้ `git commit -F` ไฟล์ เพราะ PowerShell here-string พังกับวงเล็บ/quote)
- push: ตรวจบรรทัด `main -> main` ไม่ใช่ exit code (PowerShell รายงาน stderr เป็น error ทั้งที่สำเร็จ)

---

## File Structure

- Create `lib/lineChannelRepo.ts` — CRUD ของ `line_channels` (saveChannel/getByShop/getByBotUserId/deleteChannel)
- Modify `lib/db.ts` — เพิ่ม `CREATE TABLE line_channels` + index
- Modify `lib/lineClient.ts` — ฟังก์ชันรับ credential ต่อร้านเป็นพารามิเตอร์ + `fetchBotInfo` (+ mock)
- Modify `lib/types.ts` — เพิ่ม `LineChannelStatus`
- Create `app/api/line/connect/route.ts` — POST เชื่อม
- Create `app/api/line/connect/status/route.ts` — GET สถานะ + webhook URL
- Create `app/api/line/connect/disconnect/route.ts` — POST ยกเลิก
- Modify `app/api/line/webhook/route.ts` — route ตาม destination + verify ต่อร้าน
- Modify `app/api/line/send/route.ts` — ใช้ token ต่อร้าน (fallback env)
- Modify `app/Dashboard.tsx` (SettingsView) — กล่อง wizard "เชื่อม LINE"

---

## Task 1: ตาราง line_channels + repo

**Files:** Modify `lib/db.ts`; Create `lib/lineChannelRepo.ts`; Modify `lib/types.ts`

**Produces:**
- `saveChannel(shopId, {channelSecret, accessToken, botUserId, botBasicId, displayName}): Promise<void>` (upsert ตาม shop_id)
- `getChannelByShop(shopId): Promise<LineChannelRow | null>`
- `getChannelByBotUserId(botUserId): Promise<LineChannelRow | null>`
- `deleteChannel(shopId): Promise<void>`
- type `LineChannelStatus = { connected: boolean; displayName?: string; basicId?: string; webhookUrl?: string; mock?: boolean }`

- [ ] เพิ่ม `CREATE TABLE IF NOT EXISTS line_channels (...)` + `CREATE INDEX idx_line_channels_bot` ใน ensureSchema (db.ts) ตามคอลัมน์ในสเปก (id, shop_id UNIQUE, channel_secret, access_token, bot_user_id UNIQUE, bot_basic_id, display_name, created_at, updated_at)
- [ ] เขียน `lib/lineChannelRepo.ts` (ใช้ query/queryOne/newId)
- [ ] เพิ่ม `LineChannelStatus` ใน types.ts
- [ ] ตรวจ: `npx tsc --noEmit` ผ่าน
- [ ] commit: "feat: ตาราง line_channels + repo (เชื่อม LINE ต่อร้าน)"

## Task 2: lineClient ต่อร้าน + fetchBotInfo

**Files:** Modify `lib/lineClient.ts`

**Consumes:** —
**Produces:**
- `verifySignature(rawBody, signature, channelSecret): boolean`
- `pushMessage(accessToken, lineUserId, text): Promise<boolean>` (mock ถ้า token/userId ขึ้นต้น mock-)
- `fetchBotInfo(accessToken): Promise<{userId,basicId,displayName} | null>` (GET /v2/bot/info; ถ้า token ขึ้นต้น mock- → คืน botUserId จำลองจาก hash ของ token)
- `fetchDisplayName(accessToken, lineUserId): Promise<string>`

- [ ] แก้ลายเซ็นฟังก์ชันให้รับ secret/token เป็นพารามิเตอร์ (เลิกอ่าน env ตรงๆ ในฟังก์ชัน)
- [ ] เพิ่ม `fetchBotInfo` + mock path
- [ ] ตรวจ: `npx tsc --noEmit` (จะ error ที่ webhook/send ที่ยังเรียกแบบเก่า — แก้ใน Task 4/5; ถ้าจำเป็นให้แก้ call site ชั่วคราวให้คอมไพล์ผ่านพร้อมกัน)
- [ ] commit: "refactor: lineClient รับ credential ต่อร้าน + fetchBotInfo"

## Task 3: routes connect / status / disconnect

**Files:** Create 3 ไฟล์ใน `app/api/line/connect/`

**Consumes:** lineChannelRepo (Task1), lineClient.fetchBotInfo (Task2), getCurrentAdmin

- [ ] `connect/route.ts` POST: รับ {channelSecret, accessToken} → `fetchBotInfo` → ถ้า null คืน 400 "token ไม่ถูกต้อง" → `saveChannel` → คืน {ok, displayName, basicId}
- [ ] `connect/status/route.ts` GET: `getChannelByShop` → คืน LineChannelStatus (+ webhookUrl จาก origin ของ request, + mock=ค่า isLineConfigured/หรือ token ขึ้นต้น mock-)
- [ ] `connect/disconnect/route.ts` POST: `deleteChannel`
- [ ] ตรวจ: `npx tsc --noEmit`
- [ ] commit: "feat: API เชื่อม/สถานะ/ยกเลิกเชื่อม LINE ต่อร้าน"

## Task 4: webhook route ตาม destination

**Files:** Modify `app/api/line/webhook/route.ts`

**Consumes:** getChannelByBotUserId, verifySignature, fetchDisplayName, ingestCustomerMessage

- [ ] อ่าน raw body + sig → parse payload → อ่าน `destination`
- [ ] `getChannelByBotUserId(destination)` → ถ้าเจอ ใช้ secret/token ร้านนั้น; ถ้าไม่เจอ fallback env เดิม (resolveShopId) — ถ้าไม่มีทั้งคู่ คืน 200 เฉยๆ
- [ ] verify ด้วย secret ที่ได้ → ไม่ผ่าน 401
- [ ] วน text events → ingestCustomerMessage(shopId,...) ดึงชื่อด้วย token ร้านนั้น
- [ ] ตรวจ: `npx tsc --noEmit` + `npm run build`
- [ ] commit: "feat: webhook LINE route ตามไอดีบอท + verify ต่อร้าน"

## Task 5: send ใช้ token ต่อร้าน

**Files:** Modify `app/api/line/send/route.ts`

- [ ] โหลด `getChannelByShop(shopId)` → ถ้ามี ใช้ token ร้านนั้นกับ `pushMessage`; ถ้าไม่มี fallback env token เดิม
- [ ] ตรวจ: `npx tsc --noEmit`
- [ ] commit: "feat: ส่งข้อความ LINE ด้วย token ต่อร้าน"

## Task 6: UI wizard เชื่อม LINE (SettingsView)

**Files:** Modify `app/Dashboard.tsx`

**Consumes:** /api/line/connect, /status, /disconnect

- [ ] เพิ่มคอมโพเนนต์ `LineConnectBox` ในหน้า SettingsView: fetch status ตอน mount; ถ้ายังไม่เชื่อม → โชว์ขั้นตอน + ช่องวาง secret/token + ปุ่มเชื่อม + ปุ่มคัดลอก Webhook URL; ถ้าเชื่อมแล้ว → โชว์ชื่อ OA + ปุ่มยกเลิกเชื่อม; ธีมเหมือนกล่อง marketplace (เขียว LINE)
- [ ] ตรวจ: `npx tsc --noEmit` + `npm run build`
- [ ] commit: "feat: หน้า wizard เชื่อม LINE ในตั้งค่าร้าน"

## Task 7: smoke test end-to-end (mock) + push

**Files:** ใช้ scripts ชั่วคราว (ไม่ commit)

- [ ] start dev (port 3210), สร้างร้านทดสอบ `mkt_line_<rand>`
- [ ] POST /api/line/connect ด้วย accessToken=`mock-xxx` → ได้ botUserId จำลอง, status=เชื่อมแล้ว
- [ ] สร้าง payload webhook (destination=botUserId, ลายเซ็นจาก mock channelSecret) → POST /api/line/webhook → ข้อความเข้ากล่องแชตร้านนั้น
- [ ] ลายเซ็นผิด → 401
- [ ] /api/line/send → mock ไม่ยิงจริง, บันทึก admin message
- [ ] disconnect → status กลับเป็นยังไม่เชื่อม
- [ ] ลบร้านทดสอบ (`scripts/clean-test.mjs`), หยุด dev
- [ ] push (ตรวจ `main -> main`)

---

## Self-Review (ครอบคลุมสเปก)

- สเปก §3 ตาราง → Task1 ✓ | §4.1 lineClient → Task2 ✓ | §4.2 repo → Task1 ✓ | §4.3 routes → Task3/4/5 ✓ | §4.4 UI → Task6 ✓ | §5 flow → Task4/5 ✓ | §6 security (verify ต่อร้าน, login, ไม่คืน credential) → Task3/4 ✓ | §7 acceptance → Task7 ✓
- ไม่มี placeholder; ชื่อฟังก์ชันสอดคล้องกันทุก Task (saveChannel/getChannelByShop/getChannelByBotUserId/deleteChannel/fetchBotInfo/verifySignature/pushMessage)
