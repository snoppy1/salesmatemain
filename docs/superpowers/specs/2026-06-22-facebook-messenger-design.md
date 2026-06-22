# Facebook Messenger Integration — Design

**Goal:** ให้ร้านรับ–ส่งแชต Facebook Messenger ในกล่องแชตเดียวกับ LINE โดยใช้เครื่อง AI ตอบ (auto/manual) ตัวเดิม

**Approach:** มิเรอร์โครงสร้าง LINE ทั้งหมด (mock-first) เพิ่มการ dispatch ช่องทางในจุดที่ "ส่งออก" จริง

## ขอบเขต
- Messenger ของ Facebook Page เท่านั้น (ไม่รวม Instagram DM)
- Mock-first: token ขึ้นต้น `mock-` → ไม่ยิง Graph API จริง ทดสอบได้เลย
- พอใส่ Page Access Token จริง + ตั้ง env ระดับแอป → สลับไปใช้ของจริงอัตโนมัติ

## สถาปัตยกรรม

### ต่างจาก LINE
| | LINE | Facebook |
|---|---|---|
| Webhook | ต่อ OA (verify ด้วย channel secret ต่อร้าน) | **เดียวระดับแอป** (verify ด้วย App Secret ระดับ env) |
| ยืนยัน webhook | ไม่มี | Meta เรียก GET ตอบ `hub.challenge` ด้วย Verify Token (env) |
| ลายเซ็น | `X-Line-Signature` (base64) | `X-Hub-Signature-256` (`sha256=`+hex) |
| ส่งกลับ | Reply (มี replyToken) / Push | Send API เท่านั้น (recipient = PSID) |
| routing หลายร้าน | `destination` = botUserId | `entry[].id` = pageId |
| credential ต่อร้าน | channel secret + access token | **Page Access Token** อย่างเดียว |

### env ระดับแอป (ตั้งครั้งเดียว)
- `FB_APP_SECRET` — ใช้ verify ลายเซ็น webhook
- `FB_VERIFY_TOKEN` — ใช้ตอน Meta ยืนยัน webhook (ตั้งเองอะไรก็ได้)

### ไฟล์ใหม่
- `lib/facebookClient.ts` — `verifySignature`, `sendMessage(pageToken, psid, text)`, `fetchPageInfo(pageToken)`, `fetchUserName(pageToken, psid)`, `isFacebookConfigured()` (mock-aware ทุกตัว)
- `lib/facebookChannelRepo.ts` — `saveChannel`, `getChannelByShop`, `getChannelByPageId`, `deleteChannel` (ตาราง `facebook_channels`)
- `app/api/facebook/webhook/route.ts` — GET (challenge) + POST (events → ingest → auto-reply ผ่าน `after()`)
- `app/api/facebook/connect/route.ts` — รับ Page Access Token → `fetchPageInfo` → บันทึก
- `app/api/facebook/connect/status/route.ts`, `.../disconnect/route.ts`
- `app/api/facebook/send/route.ts` — แอดมินกดส่ง (manual)

### แก้ไฟล์เดิม
- `lib/db.ts` — เพิ่มตาราง `facebook_channels` + index
- `lib/autoReply.ts` — `processAutoReply` ตัดพารามิเตอร์ `accessToken`, resolve token ตาม `channel` ของบทสนทนาเอง + ส่งตามช่องทาง (line: reply/push, facebook: Send API)
- `app/api/line/{webhook,simulate,automode,mode}/route.ts` — เลิกส่ง `accessToken` ให้ `processAutoReply`
- `app/api/line/simulate/route.ts` — รับ `channel` (ค่าเริ่มต้น `line`) เพื่อจำลองลูกค้า FB ได้
- `lib/types.ts` — เพิ่ม `FacebookChannelStatus`
- `app/InboxView.tsx` — เพิ่ม Facebook ใน `PLATFORMS` (ไอคอน/สีต่อแพลตฟอร์ม), ส่ง/จำลองตามช่องทางของบทสนทนา
- `app/Dashboard.tsx` — เพิ่ม `FacebookConnectBox` ในหน้าตั้งค่า

## ความปลอดภัย / กันพัง
- webhook จริงต้องมี `FB_APP_SECRET` ไม่งั้นปฏิเสธ (โหมด mock ใช้แชทจำลองแทน ไม่ผ่าน webhook)
- กันข้อความซ้ำด้วย `ext_id` = message.mid (เหมือน LINE)
- ข้าม `is_echo` (ข้อความที่เพจส่งเอง) กัน loop

## ทดสอบ
- ใช้ร้านทิ้ง (username `mkt_*`) + แชทจำลอง channel `facebook` ในโหมด auto → AI ตอบ; โหมด manual → เสนอคำตอบ/ร่าง
- ล้างด้วย `scripts/clean-test.mjs`
