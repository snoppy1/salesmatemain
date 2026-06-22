# TikTok Integration — Design (catalog + chat)

**Goal:** เชื่อม TikTok Shop 2 ส่วน — ดึงสินค้าเข้าคลัง + รับ/ส่งแชตในกล่องแชตเดียวกับ LINE/Facebook (AI ตอบตัวเดิม)

**Approach:** มิเรอร์ของเดิม mock-first
- ฝั่งดึงสินค้า = มิเรอร์ Shopee/Lazada (ตาราง `connections`, OAuth, import)
- ฝั่งแชต = มิเรอร์ Facebook (channel repo, webhook, send, channel-aware autoReply)

## ขอบเขต
- TikTok Shop Product API (ดึงสินค้า) + TikTok IM (แชต)
- Mock-first: token ขึ้นต้น `mock-` → ไม่ยิง API จริง

## ส่วน A — ดึงสินค้า (มิเรอร์ Shopee)
- `lib/tiktok.ts` — `isTiktokConfigured`, `buildAuthUrl`, `exchangeCode`, `refreshTokens`, `fetchCatalog` (mock-aware, HMAC-SHA256 signing)
- `lib/connectionRepo.ts` — เพิ่ม tiktok ใน `refresherFor`
- `app/api/connect/tiktok/{route,callback,status,import,disconnect}` — เหมือน shopee เป๊ะ
- `app/Dashboard.tsx` — เพิ่ม TikTok ใน `MARKETPLACES` + `PLATFORM_BADGE` (source CSV รองรับอยู่แล้ว)

## ส่วน B — แชต (มิเรอร์ Facebook)
- `lib/tiktokClient.ts` — `verifySignature`, `sendMessage`, `fetchAccountInfo`, `fetchUserName`, `isTiktokChatConfigured`
- `lib/tiktokChannelRepo.ts` — ตาราง `tiktok_channels` (saveChannel / getChannelByShop / getChannelByAccountId / deleteChannel)
- `lib/autoReply.ts` — เพิ่ม branch `channel === "tiktok"` (ส่งผ่าน TikTok IM)
- `app/api/tiktok/{webhook,connect,connect/status,connect/disconnect,send}`
- `app/InboxView.tsx` — เพิ่ม TikTok ใน `PLATFORMS` (ไอคอนโน้ต สีดำ) + `sendBaseFor()`
- `app/api/line/simulate` — รับ channel `tiktok`
- `app/Dashboard.tsx` — `TiktokConnectBox` ในหน้าตั้งค่า

## env (ตั้งครั้งเดียว ระดับแอป)
- `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` — ดึงสินค้า (Partner)
- `TIKTOK_CHAT_SECRET` — verify webhook แชต

## ข้อจำกัด (สื่อสารกับผู้ใช้แล้ว)
- API แชท TikTok Shop เปิดให้บุคคลที่ 3 จำกัด + ต้องเป็น Partner — โค้ดส่วน "จริง" เป็น best-effort ตาม Partner API v2 พอได้สิทธิ์ค่อยปรับ endpoint โหมด mock ใช้ได้เลย

## ทดสอบ
- ร้านทิ้ง `mkt_*`: เชื่อม mock → ดึงสินค้า 6 รายการ source=tiktok ✅ + จำลองลูกค้า channel tiktok → AI ตอบผ่าน TikTok ✅ (ผ่านทั้งหมด) ล้างด้วย `scripts/clean-test.mjs`
