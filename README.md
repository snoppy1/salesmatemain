# พ่วง — AI Upsell Suggestion Tool

เครื่องมือช่วยแอดมินร้านแชต (LINE/Facebook/IG) เจน "ประโยคขายพ่วง" (cross-sell/upsell)
จากบทสนทนาลูกค้า แบบ **human-in-the-loop** — AI แค่แนะนำ แอดมินอ่านแล้วกดส่งเอง

## สแตก

- Next.js (App Router) + React + Tailwind CSS
- เรียก Anthropic API ผ่าน server-side route `/api/generate` เท่านั้น
- **หลายร้าน + login:** แต่ละร้านมีบัญชีแอดมิน (username/password) เห็นเฉพาะข้อมูลร้านตัวเอง
- เก็บข้อมูลใน **Postgres** (Neon) — ใช้ `DATABASE_URL` เดียวทั้งตอนรันในเครื่องและบน Vercel ตารางสร้างอัตโนมัติครั้งแรกที่รัน
- รหัสผ่าน hash ด้วย `scrypt`, session แบบ HttpOnly cookie
- **โซนผู้ดูแลระบบ** (`/admin`) ดู/แก้ได้ทุกร้าน — บัญชีอยู่ใน env (`PHUANG_ADMIN_USER/PASS`)

## รันในเครื่อง

```bash
npm install
cp .env.local.example .env.local   # แล้วใส่ค่าจริง (ดูด้านล่าง)
npm run dev
```

เปิด http://localhost:3000

ค่าใน `.env.local`:

| ตัวแปร | ใช้ทำอะไร |
|--------|-----------|
| `ANTHROPIC_API_KEY` | คีย์ Anthropic (เรียกฝั่ง server เท่านั้น) |
| `DATABASE_URL` | connection string ของ Postgres/Neon |
| `PHUANG_ADMIN_USER` / `PHUANG_ADMIN_PASS` | บัญชีผู้ดูแลระบบ (ถ้าไม่ตั้ง โซน `/admin` จะปิด) |

> **ความปลอดภัย:** API key อยู่ฝั่ง server เท่านั้น frontend ไม่เคยเห็นคีย์ — เรียกผ่าน `/api/generate` อย่างเดียว

## การใช้งาน

1. เปิดครั้งแรก → หน้า **สมัครเปิดร้านใหม่** (`/signup`): ใส่ชื่อร้าน + username + password
2. ครั้งถัดไป → **เข้าสู่ระบบ** (`/login`)
3. แต่ละบัญชีเห็นเฉพาะข้อมูลร้านตัวเอง กด **บันทึก** เพื่อเซฟชื่อร้าน/โทน/คู่พ่วงลง DB

## Deploy (Vercel + Neon)

1. **สร้าง Postgres ที่ Neon** (https://neon.tech ฟรี) → คัดลอก connection string (ตัวที่มี `-pooler`)
2. ใส่ `DATABASE_URL` ใน `.env.local` แล้วลอง `npm run dev` ในเครื่องก่อน — ตารางจะถูกสร้างอัตโนมัติ
3. push โค้ดขึ้น GitHub → import repo เข้า https://vercel.com
4. ที่ Vercel ตั้ง environment variables: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PHUANG_ADMIN_USER`, `PHUANG_ADMIN_PASS`
5. กด Deploy

> Neon DB เดียวใช้ได้ทั้ง local และ production การ migrate ตาราง (CREATE TABLE IF NOT EXISTS)
> ทำงานอัตโนมัติครั้งแรกที่แอปเชื่อม DB ไม่ต้องรันสคริปต์แยก

## โครงสร้าง

- `app/page.tsx` — server component: เช็ก login + โหลดข้อมูลร้าน แล้วส่งให้ `Dashboard`
- `app/Dashboard.tsx` — UI หลัก (ตั้งค่าร้าน + คู่พ่วง + console เจนประโยค + ผลลัพธ์ 4 สถานะ + บันทึก/ออกจากระบบ)
- `app/login` , `app/signup` — หน้าเข้าสู่ระบบ / สมัคร
- `app/api/auth/{signup,login,logout}` — จัดการบัญชี + session
- `app/api/shop` — โหลด/บันทึกข้อมูลร้าน + คู่พ่วง (ต้อง login)
- `app/api/generate/route.ts` — เรียก Anthropic (server-side, ต้อง login)
- `proxy.ts` — กันหน้าแอปไว้หลัง login (redirect ไป `/login` ถ้าไม่มี session)
- `app/admin` — โซนผู้ดูแลระบบ (เลือกร้าน → ดู/แก้ทุกร้าน)
- `app/api/admin/*` — login/logout ผู้ดูแล + list/แก้ข้อมูลรายร้าน
- `lib/db.ts` — เชื่อม Postgres (pool) + สร้างตารางอัตโนมัติ
- `lib/superAuth.ts` — auth ผู้ดูแลระบบ (env-based, cookie แยก)
- `lib/auth.ts` — hash รหัสผ่าน (scrypt) + session + cookie
- `lib/shopRepo.ts` — อ่าน/เขียนข้อมูลร้าน + คู่พ่วง
- `lib/prompt.ts` — system prompt + ประกอบ user content + parse JSON
- `lib/types.ts` — Shop / Rule / Admin / Generate types

## ขอบเขต (MVP)

ทำเฉพาะ: ตั้งค่าร้าน + จัดการคู่พ่วง + เจนประโยค + คัดลอก + บันทึก localStorage + สถานะผลลัพธ์ 4 แบบ
ยังไม่ทำ: browser extension, auto-mining, multi-user/login/billing, เชื่อม LINE/Meta API, proactive gen
s