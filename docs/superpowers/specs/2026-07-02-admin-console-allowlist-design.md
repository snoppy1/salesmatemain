# Admin Home Console + Email Allowlist — Design

**วันที่:** 2026-07-02 · **สถานะ:** อนุมัติแล้ว (แนวทาง A)
**เป้าหมาย:** ก่อนเปิด beta — (1) กันคนนอกสมัครใช้เองแม้มีลิงก์ (email allowlist) (2) หน้า Home ให้เจ้าของระบบเห็นภาพรวมทุกร้าน + ประมาณการใช้ AI + จัดการ allowlist ในที่เดียว

## บริบทของเดิม (ยืนยันจากโค้ดแล้ว)
- Superadmin มีอยู่แล้ว: login ที่ `/admin/login` ผ่าน `PHUANG_ADMIN_USER/PASS` (lib/superAuth.ts, ตาราง super_sessions) — guard ทุก API ด้วย `getCurrentSuperadmin()` → 401
- Console เดิม `app/admin/AdminConsole.tsx` (506 บรรทัด): ลิสต์ร้าน (`GET /api/admin/shops`) + ตัวแก้ร้านทีละร้าน (`GET/PUT /api/admin/shops/[id]`)
- การสมัครเปิดโล่ง 2 ทาง (ทั้งคู่มีอีเมลเสมอ):
  - ฟอร์ม: `POST /api/auth/signup` — ใช้อีเมลเป็น username → `createAccount`
  - Google: `app/api/auth/google/callback` — `findAdminByGoogle` เจอ = login; ไม่เจอ = `createAccount` ทันที
- สคีมา DB init รวมที่ `lib/db.ts` (บล็อก `CREATE TABLE IF NOT EXISTS`)

## 1) Email Allowlist

### ตารางใหม่ (เพิ่มใน lib/db.ts)
```sql
CREATE TABLE IF NOT EXISTS allowed_emails (
  email      TEXT PRIMARY KEY,      -- lowercase เสมอ
  note       TEXT NOT NULL DEFAULT '', -- โน้ตช่วยจำ เช่น "ร้านแบต Nathapat"
  created_at BIGINT NOT NULL
);
```

### lib/allowlistRepo.ts (ใหม่)
- `isEmailAllowed(email: string): Promise<boolean>` — เทียบ `lower(trim(email))`
- `addAllowedEmail(email: string, note: string): Promise<void>` — upsert (ซ้ำ = อัปเดต note)
- `removeAllowedEmail(email: string): Promise<void>`
- `listAllowedEmails(): Promise<{ email, note, createdAt, registered }[]>` — `registered` = มีแถวใน `admins` ที่ `lower(email)` ตรง (LEFT JOIN)

### จุดบังคับ (2 จุด — ครอบทุกทางสมัคร)
1. **`POST /api/auth/signup`**: หลัง validate อีเมล → `if (!(await isEmailAllowed(email)))` → `403 { error: "อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน" }` (ก่อนเช็ค identifierTaken)
2. **Google callback**: เฉพาะ branch "ไม่เจอ admin เดิม" (คนใหม่) → ถ้าอีเมลไม่อยู่ใน allowlist → **ไม่** `createAccount`, redirect `${origin}/login?e=not_invited` — หน้า login แสดงข้อความเดียวกันเมื่อ `e=not_invited`

### กติกา
- บัญชีที่มีอยู่แล้ว: ล็อกอินได้เสมอ ไม่เช็ค allowlist (คุมเฉพาะ "สมัครใหม่")
- ลบอีเมลออกจากลิสต์ = กันสมัครใหม่เท่านั้น ไม่ลบ/ไม่แบนบัญชีที่สมัครไปแล้ว
- เทียบแบบ case-insensitive: เก็บและเช็ค lowercase+trim เสมอ

## 2) Admin Console — 3 แท็บ

โครง: `AdminConsole.tsx` ถือ state แท็บ (`home | shops | allowlist`, default `home`) + ย้าย UI ใหม่ไปไฟล์แยก กัน AdminConsole บวม:
- `app/admin/HomeTab.tsx` (ใหม่)
- `app/admin/AllowlistTab.tsx` (ใหม่)
- แท็บ "ร้านค้า" = ตัวแก้ร้านเดิมทั้งก้อน (ShopEditor + ลิสต์) — **ไม่แตะ logic เดิม**

### แท็บ "หน้าแรก" (HomeTab)
- การ์ดสรุป 4 ใบ: ร้านทั้งหมด · ร้าน active วันนี้ (มีข้อความลูกค้าวันนี้) · ข้อความลูกค้าวันนี้ (รวมทุกร้าน) · ค่า AI วันนี้โดยประมาณ (= ข้อความลูกค้าวันนี้ × ฿0.5)
- ตารางร้าน เรียงตามใช้งานล่าสุด: ชื่อร้าน (คลิก → เปิดตัวแก้ร้านในแท็บร้านค้า) / อีเมลเจ้าของ (แถวแรกของ admins ต่อร้าน) / ช่องทางที่เชื่อม (badge LINE·Lazada·FB จากตาราง line_channels, lazada_channels, facebook_channels) / จำนวนสินค้า / บทสนทนา / ข้อความลูกค้า วันนี้·7วัน / ค่า AI ≈ ฿ (7วัน × 0.5) / ใช้งานล่าสุด (max last_message_at)
- "วันนี้" = เริ่มเที่ยงคืนตามเวลาไทย (Asia/Bangkok, UTC+7 คำนวณ epoch ms ฝั่ง JS แล้วส่งเป็นพารามิเตอร์ SQL)
- ประมาณค่า AI ใช้สูตรง่าย: ข้อความลูกค้า 1 ข้อความ ≈ 1 การตอบของ AI ≈ ฿0.5 (ค่า warm เฉลี่ยที่วัดจริง) — แสดงคำว่า "โดยประมาณ" กำกับ

### แท็บ "อีเมลที่อนุญาต" (AllowlistTab)
- ฟอร์มบน: ช่องอีเมล + ช่องโน้ต (ไม่บังคับ) + ปุ่ม "เพิ่ม" (validate รูปแบบอีเมลฝั่ง UI + ฝั่ง API)
- ตาราง: อีเมล / โน้ต / สถานะ (✅ สมัครแล้ว · ⏳ ยังไม่สมัคร) / วันที่เพิ่ม / ปุ่มลบ (confirm ก่อนลบ)

## 3) API ใหม่ (ทั้งหมด guard ด้วย getCurrentSuperadmin เหมือน /api/admin/shops)
- `GET /api/admin/overview` → `{ cards: {...}, shops: ShopOverviewRow[] }` — คิวรีรวมใน `lib/adminStats.ts` (ใหม่): `getAdminOverview()` ใช้ SQL aggregate (JOIN conversations/messages/products/channels แบบ subquery ต่อร้าน — ร้านระดับสิบร้านเพียงพอ ไม่ต้อง cache)
- `GET /api/admin/allowlist` → `{ emails: [...] }`
- `POST /api/admin/allowlist` body `{ email, note }` → เพิ่ม (400 ถ้าอีเมลผิดรูปแบบ)
- `DELETE /api/admin/allowlist` body `{ email }` → ลบ

## 4) ไฟล์ที่แตะ
| ไฟล์ | ทำอะไร |
|---|---|
| lib/db.ts | เพิ่ม CREATE TABLE allowed_emails |
| lib/allowlistRepo.ts (ใหม่) | CRUD + isEmailAllowed |
| lib/adminStats.ts (ใหม่) | getAdminOverview() |
| app/api/admin/allowlist/route.ts (ใหม่) | GET/POST/DELETE |
| app/api/admin/overview/route.ts (ใหม่) | GET |
| app/api/auth/signup/route.ts | เช็ค allowlist ก่อนสร้างบัญชี |
| app/api/auth/google/callback/route.ts | เช็ค allowlist เฉพาะบัญชีใหม่ → redirect ?e=not_invited |
| app/login/page.tsx | แสดงข้อความเมื่อ e=not_invited |
| app/admin/AdminConsole.tsx | ใส่แท็บ 3 แท็บ, ย้ายของเดิมเข้าแท็บ "ร้านค้า" |
| app/admin/HomeTab.tsx (ใหม่) | การ์ดสรุป + ตารางร้าน |
| app/admin/AllowlistTab.tsx (ใหม่) | จัดการอีเมล |

## 5) Edge cases
- อีเมลพิมพ์ต่างเคส ("Test@X.com" vs "test@x.com") → เก็บ/เช็ค lowercase เสมอ → ตรงกัน
- เพิ่มอีเมลซ้ำ → upsert อัปเดต note ไม่ error
- คนถูกลบจาก allowlist หลังสมัครแล้ว → ใช้งานต่อได้ (ตามกติกา)
- Google user ที่มีบัญชีเดิม (findAdminByGoogle เจอ) → ล็อกอินผ่านแม้ไม่อยู่ใน allowlist
- ร้านที่ไม่มีข้อความเลย → แสดง 0/–, ไม่ error (COALESCE)

## 6) การทดสอบ
- Unit (vitest): allowlistRepo — เพิ่ม/เช็ค case-insensitive/ลบ/upsert ซ้ำ (ใช้อีเมล throwaway `zz-test-*@example.com` แล้วลบทิ้งในเทสต์ ตามกฎ no-destructive-tests)
- Manual gate ก่อน merge: (1) สมัครฟอร์มด้วยอีเมลนอกลิสต์ → 403 ข้อความถูก (2) เพิ่มในลิสต์แล้วสมัคร → ผ่าน (3) หน้า /admin เห็นการ์ด+ตารางถูกต้องเทียบ DB (4) `npx tsc --noEmit` + `npx vitest run` + `next build` ผ่าน

## นอกขอบเขต (จงใจไม่ทำรอบนี้)
- กราฟ/chart รายวัน, การวัดต้นทุน AI แบบเก็บ token จริงต่อข้อความ, ระบบแบน/ระงับบัญชีเดิม, invite link, อีเมลแจ้งเตือน
