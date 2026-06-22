# เปลี่ยน "พ่วง" → ผู้ช่วยการขาย + รูปสินค้า — Design

**Goal:** เลิกใช้ระบบคู่พ่วง (rules) ในแอปร้าน เปลี่ยนเป็นผู้ช่วยขายทั่วไป (แชต AI + คลังสินค้ามีรูป)

## ตัดสินใจ (จากผู้ใช้)
- รูปสินค้า: **อัปโหลด เก็บในระบบ** (ย่อรูปฝั่ง client → data URL → คอลัมน์ products.image_url)
- ระบบพ่วง: **เอาออกทั้งหมด** จากแอปร้าน + สมอง AI + นำเข้า + หน้าเจน
- ชื่อแอป: เก็บ "พ่วง" ไว้ก่อน

## ขอบเขต (แนวทาง "เบา-ปลอดภัย")
ลบ rules ออกจาก **แอปร้าน (Dashboard) + AI + import + generate** ส่วน type `Rule`, ตาราง `rules`,
และหน้า superadmin (AdminConsole) **คงไว้** (เป็นเครื่องมือหลังบ้าน) เพื่อลดความเสี่ยง

## สิ่งที่แก้
- **types**: Product +`image?`; ตัด `rules` ออกจาก GenerateRequest/ImportResult; `ShopData.rules?` เป็น optional
- **prompt.ts**: ลบ SYSTEM_PROMPT (เจน); buildUserContent ตัดบล็อกคู่พ่วง (เหลือคลังสินค้า); REPLY/CHOICES เปลี่ยนคำ "พ่วง"→"สินค้าเสริม"; IMPORT prompt แยกเฉพาะ products
- **claude.ts**: ลบ generateUpsell; generateReply/generateChoices ไม่รับ rules
- **shopRepo.ts**: โหลด/บันทึก image_url (คง rules ไว้สำหรับ admin)
- **db.ts**: `ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url`
- **api**: ลบ `/api/generate`; `/api/import` คืน `{products}`; draft/choices/autoReply ไม่ส่ง rules
- **marketplace/shopee/tiktok**: CatalogItem +`image`; fetchCatalog map รูป; MOCK_CATALOG ใส่ picsum; import routes แนบ image
- **Dashboard.tsx**: ตัด view "generate" + Console/ResultArea/UpsellCard; default view = inbox; เมนูเหลือ กล่องแชต/คลังสินค้า/ตั้งค่าร้าน; CatalogView = สินค้าอย่างเดียว + อัปโหลดรูป (ProductRow); ImportBox แยกเฉพาะสินค้า; marketplace import แนบรูป
- **AdminConsole.tsx**: guard `data.rules ?? []` (เพราะ ShopData.rules optional)

## ทดสอบ (mock, ร้าน mkt_*)
- เก็บรูปสินค้าที่อัปโหลด (round-trip) ✅
- /api/import คืนเฉพาะ products ✅
- AI ตอบจากคลัง (ไม่มีพ่วง) ✅
- รูปจาก marketplace import (picsum) ✅
ล้างด้วย scripts/clean-test.mjs

## เฟสต่อไป (ยังไม่ทำ)
- ส่งรูปสินค้าให้ลูกค้าในแชต (ต่อแพลตฟอร์ม)
- เปลี่ยนชื่อ/โลโก้แอป
