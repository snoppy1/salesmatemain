# พ่วง — AI Upsell Suggestion Tool

เครื่องมือช่วยแอดมินร้านแชต (LINE/Facebook/IG) เจน "ประโยคขายพ่วง" (cross-sell/upsell)
จากบทสนทนาลูกค้า แบบ **human-in-the-loop** — AI แค่แนะนำ แอดมินอ่านแล้วกดส่งเอง

## สแตก

- Next.js (App Router) + React + Tailwind CSS
- เรียก Anthropic API ผ่าน server-side route `/api/generate` เท่านั้น
- **หลายร้าน + login:** แต่ละร้านมีบัญชีแอดมิน (username/password) เห็นเฉพาะข้อมูลร้านตัวเอง
- เก็บข้อมูลใน **SQLite** (`data/phuang.db` — สร้างอัตโนมัติครั้งแรกที่รัน)
- รหัสผ่าน hash ด้วย `scrypt`, session แบบ HttpOnly cookie

## รันในเครื่อง

```bash
npm install
cp .env.local.example .env.local   # แล้วใส่ ANTHROPIC_API_KEY จริง
npm run dev
```

เปิด http://localhost:3000

> **ความปลอดภัย:** API key อยู่ฝั่ง server เท่านั้น (`process.env.ANTHROPIC_API_KEY`)
> frontend ไม่เคยเห็นคีย์ — เรียกผ่าน `/api/generate` อย่างเดียว

## การใช้งาน

1. เปิดครั้งแรก → หน้า **สมัครเปิดร้านใหม่** (`/signup`): ใส่ชื่อร้าน + username + password
2. ครั้งถัดไป → **เข้าสู่ระบบ** (`/login`)
3. แต่ละบัญชีเห็นเฉพาะข้อมูลร้านตัวเอง กด **บันทึก** เพื่อเซฟชื่อร้าน/โทน/คู่พ่วงลง DB

## Deploy (Vercel)

1. push โค้ดขึ้น git แล้ว import เข้า Vercel
2. ตั้ง environment variable `ANTHROPIC_API_KEY` ใน dashboard
3. deploy

> ⚠️ **ข้อควรรู้เรื่อง SQLite บน Vercel:** ไฟล์ระบบของ Vercel เป็นแบบ ephemeral —
> ข้อมูลใน `data/phuang.db` จะหายเมื่อ redeploy/สเกล ถ้าจะใช้จริงบน Vercel ต้องย้ายไป
> Postgres (Neon/Supabase) หรือ Turso ก่อน โครงสร้าง `lib/db.ts` + `lib/shopRepo.ts`
> แยก data layer ไว้แล้ว เปลี่ยน driver ได้ในจุดเดียว (รันในเครื่อง/เซิร์ฟเวอร์ตัวเองใช้ SQLite ได้เลย)

## โครงสร้าง

- `app/page.tsx` — server component: เช็ก login + โหลดข้อมูลร้าน แล้วส่งให้ `Dashboard`
- `app/Dashboard.tsx` — UI หลัก (ตั้งค่าร้าน + คู่พ่วง + console เจนประโยค + ผลลัพธ์ 4 สถานะ + บันทึก/ออกจากระบบ)
- `app/login` , `app/signup` — หน้าเข้าสู่ระบบ / สมัคร
- `app/api/auth/{signup,login,logout}` — จัดการบัญชี + session
- `app/api/shop` — โหลด/บันทึกข้อมูลร้าน + คู่พ่วง (ต้อง login)
- `app/api/generate/route.ts` — เรียก Anthropic (server-side, ต้อง login)
- `proxy.ts` — กันหน้าแอปไว้หลัง login (redirect ไป `/login` ถ้าไม่มี session)
- `lib/db.ts` — เปิด SQLite + สร้างตาราง
- `lib/auth.ts` — hash รหัสผ่าน (scrypt) + session + cookie
- `lib/shopRepo.ts` — อ่าน/เขียนข้อมูลร้าน + คู่พ่วง
- `lib/prompt.ts` — system prompt + ประกอบ user content + parse JSON
- `lib/types.ts` — Shop / Rule / Admin / Generate types

## ขอบเขต (MVP)

ทำเฉพาะ: ตั้งค่าร้าน + จัดการคู่พ่วง + เจนประโยค + คัดลอก + บันทึก localStorage + สถานะผลลัพธ์ 4 แบบ
ยังไม่ทำ: browser extension, auto-mining, multi-user/login/billing, เชื่อม LINE/Meta API, proactive gen
