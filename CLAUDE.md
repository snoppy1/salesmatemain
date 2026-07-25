# CLAUDE.md — SalesMate (โค้ดเนม: พ่วง/phuang)

> **หน้าที่ของไฟล์นี้:** แผนที่ระบบ + สถานะงาน สำหรับ Claude ทุกเซสชัน
> **ต้องอัปเดตไฟล์นี้เอง** ทุกครั้งที่ทำงานชิ้นใหญ่เสร็จ (feature ใหม่/เปลี่ยนโครง/ตัดสินใจสำคัญ) — แก้หัวข้อ "สถานะงาน" ให้ตรงความจริงเสมอ อย่าปล่อยให้เก่า

## ภาพรวม

ผู้ช่วยขาย AI + กล่องแชตรวมหลายแพลตฟอร์ม (LINE / Facebook / Lazada) สำหรับร้านค้า SME ไทย
จุดขาย: AI ไม่ใช่แค่ตอบ แต่ **ขายเป็น** — เสนอพ่วง (upsell) + ส่งการ์ดสินค้า + วัดยอดที่ปิดได้จริง
ผู้ใช้เป้าหมายไม่ใช่สายเทคนิค · โปรดักต์อยู่ช่วง **เบต้า** · ร้านจริง: "ร้านของ Nathapat Chanin" (แบต/BMS ~320 สินค้า), "Smarttech" (468 สินค้า) — **ห้ามลบ/แก้ข้อมูลร้านจริง** ใช้ข้อมูล zz-* ทดลองแทน
โทน/แบรนด์/กลุ่มผู้ใช้ → ดู `PRODUCT.md`

- Stack: Next.js 16 App Router · React 19 · Tailwind 3 · Neon Postgres (`pg` ตรงๆ ไม่มี ORM) · Anthropic API (raw fetch) · Vercel Hobby
- โดเมน: **salesmate.chat** (ย้ายจาก vercel.app แล้ว — callback/webhook ทุกเจ้าชี้โดเมนนี้)
- เจ้าของ (user) ไม่ใช่สายเทคนิค สื่อสารภาษาไทย อธิบายแบบไม่ต้องรู้โค้ดก็เข้าใจ

## คำสั่งที่ใช้บ่อย

```bash
npm run dev                 # dev server (อ่าน .env.local — ระวัง: DATABASE_URL ชี้ DB จริง)
npx tsc --noEmit            # typecheck
npx vitest run              # unit tests (test/*.test.ts — ตัว gate ยิง API จริงถูก guard ด้วย env ไม่รันเอง)
node scripts/zz-*.mjs       # สคริปต์ตรวจสอบ/วิเคราะห์ อ่านอย่างเดียว (ห้าม commit — เป็น throwaway)
```

**Deploy:** `git push origin feat/ui-redesign` แล้ว `git push origin feat/ui-redesign:main` (main = production บน Vercel)
Commit message: ภาษาไทยล้วน ไม่มี quote/อักขระพิเศษ ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## โครงสร้างระบบ

### หน้าบ้าน
- `public/landing.html` — หน้าแรกคนยังไม่ login (rewrite จาก `proxy.ts`) — static HTML + scroll animation ทั้งไฟล์ ต้นทางออกแบบมาจากไฟล์ `*.dc.html` ใน Downloads ของ user
- `app/login/page.tsx` — login + **AuthShell/Field/GoogleButton ฯลฯ ที่ signup/forgot ใช้ร่วม** (แก้ธีม auth = แก้ที่ AuthShell จุดเดียว)
- `app/Dashboard.tsx` + `app/InboxView.tsx` — แอปหลักหลัง login (กล่องแชต, ตั้งค่าร้าน, สินค้า) · `components/OverviewView.tsx` — หน้า overview
- `app/admin/` — super admin console (แท็บ: ร้าน/โมเดล AI/ยอดขาย AI/บัญชี/สถานะระบบ) login แยกด้วย `PHUANG_ADMIN_USER/PASS`

### API หลัก (`app/api/`)
- `auth/*` — login/signup/forgot/logout + Google OAuth (`auth/google/*`) — มี rate limit ผ่าน `lib/throttle.ts`
- `line|facebook|lazada|shopee|tiktok/webhook` — รับแชตเข้า (ตรวจลายเซ็น HMAC ทุกเจ้า)
- `connect/*` — OAuth + import สินค้าจาก marketplace
- `shop` — บันทึกข้อมูลร้าน/สินค้า (มีเพดาน: สินค้า ≤1,000, จำกัดความยาวฟิลด์, รูปเฉพาะ data:image//https)
- `line/simulate` — โหมดทดลอง (mock) จำกัด AI 5 ข้อความ + แคตตาล็อกแบต 30 ชิ้น (`lib/marketplace.ts` MOCK_CATALOG)
- `cron/prewarm` — **cron รวม 4 งาน** ยิงจาก cron-job.org ทุก 30 นาที (Bearer CRON_SECRET): อุ่นแคช + refresh token Lazada + poll แชต Lazada + แมตช์ยอดพ่วง — cron หยุด = 4 อย่างหยุด

### สมอง AI (`lib/`)
- `prompt.ts` — REPLY/CHOICES/ORDER system prompts + `buildUserContentParts` แบ่งเนื้อหาเป็น `{stable, promo, customer}` — **stable ต้อง byte-identical ระหว่าง reply กับ prewarm** ไม่งั้นแคช miss
- `claude.ts` — เรียก Anthropic + prompt caching 3 breakpoints (system/stable/promo) + tool loop ฝั่งออเดอร์
- `modelRouter.ts` — Sonnet (`claude-sonnet-4-6`) เป็นค่าหลัก / Opus (`claude-opus-4-8`) เคสเสี่ยง+รูป+ออเดอร์
- `aiPricing.ts` — ราคา + `chatCacheTtl()`: **Sonnet แคช 1h** (prewarm อ่านต่ออายุทุก 30 นาที — ห้ามใช้ 5m เดี๋ยวเจอจุดเตาซ้ำซ้อน) / **Opus แคช 5m** (ไม่มี prewarm, warm read 75% เกิดใน 5 นาที)
- `aiUsageRepo.ts` — บันทึกต้นทุนจริงต่อ call ลง `ai_usage` (ฐานของแท็บโมเดล AI ในแอดมิน)
- `catalogRetrieval.ts` + `embeddings.ts` — hybrid retrieval (Voyage + keyword) เลือกสินค้าเด่นใส่ส่วน customer
- ดัชนีสินค้าในแคช: ชื่อย่อ(ai_name)+ราคา+มี/หมด — **สิ่งที่ทำให้แคชถูกจุดใหม่: สต๊อกข้าม 0 / ราคาเปลี่ยน / สินค้าใหม่** (log ไว้ใน `product_sync_changes` ดูด้วย `scripts/zz-sync-changes.mjs`)

### ข้อมูล + การวัดผล
- `lib/db.ts` — ตารางทั้งหมดสร้างอัตโนมัติใน `ensureSchema` (ไม่มี migration แยก — เพิ่มตาราง/คอลัมน์ = แก้ที่นี่)
- `lib/upsellRepo.ts` + `upsellAttribution.ts` + `upsellMatch.ts` — วัดยอดขาย AI แบบ **สินค้า+เวลา** (Lazada ไม่บอกเจ้าของออเดอร์ → เป็นตัวเลขประมาณการ, เริ่มนับ 22 ก.ค. 2026, แมตช์เฉพาะแชต Lazada)
- `lib/lazadaOrders.ts` — orders API (`recentOrdersWithItems` ดึงย้อน 48 ชม.) — **คีย์แอปออเดอร์ (laz1) อยู่ใน Vercel เท่านั้น เทสจากเครื่องไม่ได้**; `.env.local` มีแต่คีย์แอปแชต IM
- `lib/shopRepo.ts` — `syncProductsStock` (ซิงก์ทุก 45 วิ, กันเขียนซ้ำถ้าค่าไม่เปลี่ยน + log การเปลี่ยน)

### Security (ทำแล้ว)
- Headers ครบใน `next.config.mjs` (CSP มี unsafe-inline โดยตั้งใจ — Next/landing ต้องใช้)
- `lib/throttle.ts` rate limit ใน Postgres: login 5/15นาที/อีเมล + 20/IP · signup 5/ชม./IP · forgot 10/15นาที/IP
- Session: cookie httpOnly+Secure+SameSite=Lax, token 32 ไบต์, อายุ 14 วัน · รหัสผ่าน scrypt+salt + นโยบายอายุ 90 วัน (ข้อกำหนด Lazada)
- `docs/lazada-pentest-answers.md` = ความลับ (gitignored) ห้าม commit/แชร์

## กติกาการทำงาน (สำคัญ — เจ้าของยืนยันเองทั้งหมด)

1. **คุณภาพคำตอบ AI มาก่อนการประหยัด token เสมอ** — การเปลี่ยนที่ AI มองเห็น (prompt/ดัชนี/แคชโครงสร้าง) ต้องผ่าน quality gate ก่อนขึ้นจริง (เคยพลาด: แยกรายการของหมดออกจากดัชนี → AI เชียร์ของหมด → revert)
2. **Lean execution** — subagent เท่าที่จำเป็น · เทสให้ครบในรอบเดียว · **งานเสี่ยงต้อง revert (restructure prompt/แคช/โครงใหญ่) ต้องถามก่อนลงมือ**
3. **Gate ยิง API จริง = เผาเงินจริง** (คีย์เดียวกับ prod) — ชุดเทสให้เล็กที่สุดที่ครอบคลุม เตือนก่อนรันชุดใหญ่
4. **ห้ามเทสเขียนข้อมูลบนข้อมูลจริง** — ใช้ข้อมูล zz-* แทน · ห้ามลบร้านเบต้า
5. Claude Code ใช้ subscription แยกจากคีย์ API ของแอปแล้ว (แยกเมื่อ 19 ก.ค.) — อย่า login กลับไปใช้คีย์แอป

## สถานะงาน (อัปเดตล่าสุด: 25 ก.ค. 2026)

### ✅ เสร็จแล้ว (ไฮไลต์)
- แชตรวม LINE + Facebook + Lazada (รับ/ส่ง/รูป/การ์ดสินค้า Lazada) + AI ตอบอัตโนมัติ 3 ระดับ + เพศ AI (ครับ/ค่ะ)
- Lazada ครบวงจร: app ผ่านรีวิวขึ้น Online (token 30 วัน), sync สินค้า/สต๊อก 45 วิ, โปรโมชัน, orders API, poll แชตกันพลาด webhook
- ระบบต้นทุน AI: caching ตาม TTL รายโมเดล, prewarm อ่านต่ออายุ, บีบชื่อสินค้า (ai_name), ยุบของหมดในดัชนี, แดชบอร์ดต้นทุนละเอียดในแอดมิน
- วัดยอดขาย AI: เหตุการณ์พ่วง → ส่งการ์ด → แมตช์ออเดอร์ (สินค้า+เวลา) — เริ่มนับจริง 22 ก.ค.
- กฎราคา+หน่วย (แก้ feedback ลูกค้าคิดราคาแพ็กผิด) ผ่าน gate 4/4
- กฎสี/ตัวเลือกสินค้า (แก้ feedback Smarttech: AI มโนสีเขียวเป็นคนละรุ่น) — เก็บตัวเลือกจากทุก SKU (`extractVariantOptions`) + ราคาต่อตัวเลือกเมื่อไม่เท่ากัน + sync 45 วิ เติม/รีเฟรช note "มีให้เลือก:" อัตโนมัติ (ร้านไม่ต้อง re-import, ราคาโปรฯ เปลี่ยนก็ไม่ค้าง) + กฎ 1.2 ห้ามเดาความต่างสี/ใช้ราคาตามตัวเลือก ผ่าน gate 7/7
- Access model: สมัครฟรีดูได้ทุกคน, สิทธิ์จริงคุมที่ "สร้างกล่องแชต" (allowlist)
- UI ใหม่ทั้งชุด: landing 3D scroll + การ์ดสไลด์ + โซนสว่าง, auth ธีมไฟลอย, dashboard โทนทราย
- Security hardening: rate limit + session 14 วัน + เพดานสินค้า/รูป (ทดสอบจริงผ่านแล้ว)
- แยกคีย์ Claude Code ออกจากคีย์แอป + ย้ายโดเมน salesmate.chat

### 🔄 กำลังทำ / รอข้อมูล
- **เช็ค sync รอบแรกหลัง deploy กฎสี** — note "มีให้เลือก:" ควรโผล่ใน description สินค้าที่มีตัวเลือกเองอัตโนมัติ (ดู log `product_sync_changes` บรรทัด "ตัวเลือกสินค้า")
- **เก็บ log จุดแคช Sonnet** (`product_sync_changes`) — อ่านผลราว 24-25 ก.ค. เพื่อชี้ว่าตัวการคือสต๊อกข้าม 0 หรือราคาโปรฯ แกว่ง
- **รอแมตช์ยอดพ่วงตัวแรก** — อ่านผลราว 29 ก.ค. (ถ้ายัง 0 ตลอด → ดูความถี่/ความแม่นการเสนอ ไม่ใช่ตัวแมตช์)

### 📋 แผนถัดไป (ยังไม่เริ่ม — เรียงตามลำดับ)
1. **ลดค่าเขียนแคชก้อนใหญ่**: ดัชนีอัปเดตเป็นรอบเวลา + ส่งของเพิ่งหมด/ราคาใหม่สดนอกแคช — ออกแบบตาม log ที่เก็บอยู่ **ต้องขออนุมัติ + ผ่าน gate ก่อน**
2. ปุ่มเปิด/ปิด upsell ต่อร้าน + คำตอบกระชับลง — รอคำตอบน้ากุ้ง (แชทรายวันที่ลูกค้าเจออาจเป็นของ Lazada เอง)
3. แยกจำนวนชิ้นต่อแพ็กเป็นฟิลด์ตอน import (ทำถ้ากฎราคาข้อ 1.1 ยังพลาดอีก)
4. forgot password ยังไม่ส่งอีเมลจริง (TODO รอต่อ email provider เช่น Resend)
5. เมื่อเปิดกว้างเกิน allowlist: ตัวตรวจรูป NSFW, WAF (Cloudflare), nonce CSP
6. TikTok Shop: **พักไว้** ติดเงื่อนไขต้องมีบริษัทจด >1 ปี (โค้ด+Draft app พร้อมแล้ว อย่าเสนอซ้ำ)
