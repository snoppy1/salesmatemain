# Chat Retention + Images + AI Vision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the chat DB from bloating (auto-trim + purge), capture customer images on every platform, and let Claude analyse those images when replying.

**Architecture:** Extend the shared `messages` table (`kind`/`image_url`/`blob_key`), trim to the latest 50 messages per conversation on each insert, purge dead conversations + expired hosted images via a daily Vercel Cron, host LINE images on Vercel Blob (marketplaces keep CDN links), and pass image URLs as Claude content blocks only when a chat actually contains an image.

**Tech Stack:** Next.js 16 App Router, Neon Postgres via `pg`, Anthropic `claude-sonnet-4-6` (vision-capable) via raw `fetch`, `@vercel/blob`, Vercel Cron.

## Global Constraints

- Schema changes go in `ensureSchema()` in `lib/db.ts` as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (idempotent).
- Do NOT change the shop AI model — keep `claude-sonnet-4-6` (it supports vision).
- Retention tunables live in ONE place (`lib/retention.ts` config object): `keepMessagesPerConversation: 50`, `purgeConversationsAfterDays: 365`, `deleteHostedImagesAfterDays: 60`.
- Vercel Blob is optional: if `BLOB_READ_WRITE_TOKEN` is unset, LINE images degrade to a text placeholder — the app must not crash.
- All cleanup is best-effort (`try/catch`, never throws into the message-receive path).
- Test writes ONLY against throwaway shops whose admin username starts `mkt_`; clean up with `node scripts/clean-test.mjs`. Never touch real data.
- Local test scripts (`*.mjs` in scratchpad) and `scripts/inspect-*.mjs`/`seed-*.mjs` are NOT committed.
- Image content blocks use `claude-sonnet-4-6` format: `{ type: "image", source: { type: "url", url } }` with a PUBLIC url; formats JPEG/PNG/GIF/WebP.

### Test harness procedure (referenced by every task as "run the integration test")

This project has no unit-test framework. Each behavioural test is a node `.mjs` script run over HTTP against a freshly-built `next start`, using throwaway `mkt_` shops. The cycle for any test step:

```bash
# 1. type-check / compile
npm run build            # PowerShell: npm run build

# 2. start server on 3100 (Bash tool, run_in_background)
PORT=3100 npx next start -p 3100
# poll http://localhost:3100/login until 200

# 3. run the test script (node fetch with manual cookie handling — PowerShell WebSession drops the HttpOnly cookie)
node "<scratchpad>/<test>.mjs"

# 4. stop server (PowerShell): kill the PID listening on 3100
# 5. clean throwaway shops
node scripts/clean-test.mjs
```

Every test script uses this cookie-aware `api()` helper (copy verbatim into each script):

```js
const BASE = "http://localhost:3100";
let cookie = "";
async function api(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, json: j };
}
async function signup(user) {
  return api("/api/auth/signup", "POST", { shopName: user, username: user, password: "test123456" });
}
```

"Run to verify it fails" means: with the OLD build still running (before implementing), the assertion in the script prints `FAIL`. "Run to verify it passes" means: after rebuild+restart, it prints `PASS`.

---

## Task 1: messages schema + image fields through repo + simulate image support

**Files:**
- Modify: `lib/db.ts` (ensureSchema — messages ALTERs)
- Modify: `lib/types.ts` (`ChatMessage` type)
- Modify: `lib/inboxRepo.ts` (`addMessage`, `ingestCustomerMessage`, `getConversation`)
- Modify: `app/api/line/simulate/route.ts` (accept optional `imageUrl`)
- Test: scratchpad `t1-image-msg.mjs`

**Interfaces:**
- Produces:
  - `ChatMessage = { id: string; sender: "customer"|"admin"; text: string; createdAt: number; kind: "text"|"image"; imageUrl?: string; blobKey?: string }`
  - `addMessage(conversationId, sender, text, extId?, media?: { kind: "text"|"image"; imageUrl?: string; blobKey?: string }): Promise<ChatMessage>`
  - `ingestCustomerMessage(shopId, opts)` where `opts` gains optional `kind?: "text"|"image"; imageUrl?: string; blobKey?: string`
  - `getConversation(...).messages[]` now includes `kind`, `imageUrl`, `blobKey`

- [ ] **Step 1: Write the failing test** — scratchpad `t1-image-msg.mjs`

```js
// <paste BASE/api/signup helper from Global Constraints>
const rand = Math.random().toString(36).slice(2, 8);
const user = `mkt_t1_${rand}`;
let r = await signup(user);
if (r.status !== 200) { console.log("FAIL signup", r.json); process.exit(1); }

// simulate an image message from the customer
r = await api("/api/line/simulate", "POST", {
  text: "นี่รุ่นไหนคะ",
  imageUrl: "https://picsum.photos/seed/t1/300",
});
const cid = r.json?.conversationId;
r = await api(`/api/line/conversation?id=${cid}`);
const msgs = r.json?.messages ?? [];
const img = msgs.find((m) => m.kind === "image");
console.log(img && img.imageUrl ? "PASS" : "FAIL", JSON.stringify(msgs));
```

(Check the exact conversation-fetch route/param: it is `GET /api/line/conversation?id=<cid>` per `app/api/line/conversation/route.ts`. If the param differs, match it.)

- [ ] **Step 2: Run to verify it fails** — `kind` is undefined on every message → prints `FAIL`.

- [ ] **Step 3: Implement — schema** in `lib/db.ts`, next to the existing `ALTER TABLE messages ADD COLUMN IF NOT EXISTS ext_id TEXT;`:

```js
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS blob_key TEXT;
    CREATE INDEX IF NOT EXISTS idx_messages_blob ON messages(blob_key) WHERE blob_key IS NOT NULL;
```

- [ ] **Step 4: Implement — type** in `lib/types.ts`, extend `ChatMessage`:

```ts
export type ChatMessage = {
  id: string;
  sender: "customer" | "admin";
  text: string;
  createdAt: number;
  kind: "text" | "image";
  imageUrl?: string;
  blobKey?: string;
};
```

- [ ] **Step 5: Implement — repo** in `lib/inboxRepo.ts`.

Replace `addMessage` with:

```ts
export async function addMessage(
  conversationId: string,
  sender: "customer" | "admin",
  text: string,
  extId?: string,
  media?: { kind: "text" | "image"; imageUrl?: string; blobKey?: string },
): Promise<ChatMessage> {
  const id = newId();
  const now = Date.now();
  const kind = media?.kind ?? "text";
  const imageUrl = media?.imageUrl ?? null;
  const blobKey = media?.blobKey ?? null;
  await query(
    `INSERT INTO messages (id, conversation_id, sender, text, created_at, ext_id, kind, image_url, blob_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, conversationId, sender, text, now, extId ?? null, kind, imageUrl, blobKey],
  );
  await query("UPDATE conversations SET last_message_at = $1 WHERE id = $2", [now, conversationId]);
  return { id, sender, text, createdAt: now, kind, imageUrl: imageUrl ?? undefined, blobKey: blobKey ?? undefined };
}
```

In `ingestCustomerMessage`, extend `opts` and forward media:

```ts
  opts: {
    channel: string;
    lineUserId: string;
    displayName: string;
    text: string;
    extId?: string;
    kind?: "text" | "image";
    imageUrl?: string;
    blobKey?: string;
  },
```
and change the `addMessage` call inside it to:
```ts
  await addMessage(conversationId, "customer", opts.text, opts.extId, {
    kind: opts.kind ?? "text",
    imageUrl: opts.imageUrl,
    blobKey: opts.blobKey,
  });
```

In `getConversation`, extend the SELECT + row type + mapping:
```ts
  const msgs = await query<{
    id: string; sender: string; text: string; created_at: string;
    kind: string; image_url: string | null; blob_key: string | null;
  }>(
    `SELECT id, sender, text, created_at, kind, image_url, blob_key FROM messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
  ...
    messages: msgs.map((m) => ({
      id: m.id,
      sender: m.sender === "admin" ? "admin" : "customer",
      text: m.text,
      createdAt: Number(m.created_at),
      kind: m.kind === "image" ? "image" : "text",
      imageUrl: m.image_url ?? undefined,
      blobKey: m.blob_key ?? undefined,
    })),
```

- [ ] **Step 6: Implement — simulate** in `app/api/line/simulate/route.ts`. Add `imageUrl?: string` to the parsed `body` type, and in the "new customer" branch pass media to `ingestCustomerMessage`:

```ts
    const cid = await ingestCustomerMessage(admin.shopId, {
      channel,
      lineUserId: "mock-" + newId(),
      displayName: name,
      text,
      kind: body.imageUrl ? "image" : "text",
      imageUrl: body.imageUrl,
    });
```
And in the "existing conversation" branch, replace `addMessage(body.conversationId, "customer", text)` with:
```ts
    await addMessage(body.conversationId, "customer", text, undefined, {
      kind: body.imageUrl ? "image" : "text",
      imageUrl: body.imageUrl,
    });
```

- [ ] **Step 7: Run to verify it passes** — rebuild, restart, run `t1-image-msg.mjs` → `PASS`. Then `node scripts/clean-test.mjs`.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts lib/types.ts lib/inboxRepo.ts app/api/line/simulate/route.ts
git commit -F - <<'EOF'
feat: messages เก็บชนิด/รูป (kind/image_url/blob_key) + simulate ส่งรูปได้

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 2: Vercel Blob wrapper + dependency + env

**Files:**
- Create: `lib/blobStore.ts`
- Modify: `package.json` (`@vercel/blob` dep)
- Modify: `.env.local.example`
- Test: `npm run build` (thin external wrapper; behaviour exercised in Tasks 3 & 6)

**Interfaces:**
- Produces:
  - `isBlobConfigured(): boolean`
  - `putImage(buffer: Buffer, contentType: string): Promise<{ url: string; key: string }>` — throws `Error("BLOB_NOT_CONFIGURED")` if no token
  - `delBlobs(keys: string[]): Promise<void>` — best-effort, never throws

- [ ] **Step 1: Install dependency**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Implement** `lib/blobStore.ts`

```ts
import "server-only";
import { put, del } from "@vercel/blob";
import { randomBytes } from "node:crypto";

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function extFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** อัปโหลดรูปขึ้น Vercel Blob (public) → คืน url + key (key ไว้ลบทีหลัง) */
export async function putImage(
  buffer: Buffer,
  contentType: string,
): Promise<{ url: string; key: string }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_NOT_CONFIGURED");
  const key = `chat-images/${Date.now()}-${randomBytes(6).toString("hex")}.${extFor(contentType)}`;
  const res = await put(key, buffer, {
    access: "public",
    token,
    contentType,
    addRandomSuffix: false,
  });
  return { url: res.url, key };
}

/** ลบไฟล์ออกจาก Blob — best-effort (ไม่ throw) */
export async function delBlobs(keys: string[]): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || keys.length === 0) return;
  try {
    await del(keys, { token });
  } catch {
    /* เงียบไว้ — best-effort */
  }
}
```

- [ ] **Step 3: Document env** in `.env.local.example`, after the `DATABASE_URL` block:

```
# Vercel Blob — โฮสต์รูปจาก LINE (ลิงก์รูป LINE ใช้ token + หมดอายุ จึงต้องโหลดมาฝาก)
# ถ้าไม่ตั้ง: รูป LINE จะแสดงเป็นป้าย "ลูกค้าส่งรูป" แทน (ระบบไม่ล่ม)
# BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxx
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add lib/blobStore.ts package.json package-lock.json .env.local.example
git commit -F - <<'EOF'
feat: ตัวห่อ Vercel Blob (putImage/delBlobs) สำหรับโฮสต์รูป LINE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 3: Retention — trim to 50 messages on insert (+ delete their blobs)

**Files:**
- Create: `lib/retention.ts` (config + `trimConversation`)
- Modify: `lib/inboxRepo.ts` (`addMessage` calls `trimConversation` after insert)
- Test: scratchpad `t3-trim.mjs`

**Interfaces:**
- Consumes: `delBlobs(keys)` from `lib/blobStore.ts`.
- Produces:
  - `RETENTION = { keepMessagesPerConversation: 50, purgeConversationsAfterDays: 365, deleteHostedImagesAfterDays: 60 }`
  - `trimConversation(conversationId: string): Promise<void>` — best-effort; deletes messages beyond the newest 50, deletes their hosted blobs.

- [ ] **Step 1: Write the failing test** — scratchpad `t3-trim.mjs`

```js
// <paste BASE/api/signup helper>
const rand = Math.random().toString(36).slice(2, 8);
const user = `mkt_t3_${rand}`;
let r = await signup(user); if (r.status !== 200) { console.log("FAIL signup"); process.exit(1); }

// send 55 messages into one conversation
r = await api("/api/line/simulate", "POST", { text: "msg-1" });
const cid = r.json.conversationId;
for (let i = 2; i <= 55; i++) {
  await api("/api/line/simulate", "POST", { text: `msg-${i}`, conversationId: cid });
}
r = await api(`/api/line/conversation?id=${cid}`);
const n = (r.json?.messages ?? []).length;
const oldestText = r.json.messages[0]?.text;
// expect exactly 50, and the oldest kept is msg-6 (1..5 trimmed)
console.log(n === 50 && oldestText === "msg-6" ? "PASS" : `FAIL n=${n} oldest=${oldestText}`);
```

- [ ] **Step 2: Run to verify it fails** — before implementing, all 55 remain → `FAIL n=55`.

- [ ] **Step 3: Implement** `lib/retention.ts`

```ts
import "server-only";
import { query } from "./db";
import { delBlobs } from "./blobStore";

export const RETENTION = {
  keepMessagesPerConversation: 50,
  purgeConversationsAfterDays: 365,
  deleteHostedImagesAfterDays: 60,
};

/** เก็บแค่ N ข้อความล่าสุดต่อบทสนทนา ลบที่เก่ากว่า + ลบไฟล์รูปที่เราโฮสต์ (best-effort) */
export async function trimConversation(conversationId: string): Promise<void> {
  try {
    const keep = RETENTION.keepMessagesPerConversation;
    const doomed = await query<{ id: string; blob_key: string | null }>(
      `SELECT id, blob_key FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       OFFSET $2`,
      [conversationId, keep],
    );
    if (doomed.length === 0) return;
    const ids = doomed.map((d) => d.id);
    const keys = doomed.map((d) => d.blob_key).filter((k): k is string => Boolean(k));
    await delBlobs(keys);
    await query("DELETE FROM messages WHERE id = ANY($1)", [ids]);
  } catch {
    /* เงียบไว้ — ห้ามกระทบ flow รับข้อความ */
  }
}
```

- [ ] **Step 4: Wire into `addMessage`** in `lib/inboxRepo.ts` — import and call at the end (before `return`):

Add import at top: `import { trimConversation } from "./retention";`
At the end of `addMessage`, before `return { ... }`:
```ts
  await trimConversation(conversationId);
```

- [ ] **Step 5: Run to verify it passes** — rebuild, restart, run `t3-trim.mjs` → `PASS`. Clean.

- [ ] **Step 6: Commit**

```bash
git add lib/retention.ts lib/inboxRepo.ts
git commit -F - <<'EOF'
feat: ตัดข้อความเก่าอัตโนมัติ เก็บ 50 ล่าสุด/บทสนทนา (+ลบไฟล์รูปที่โฮสต์)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 4: Retention cron — purge dead conversations + expire old hosted images

**Files:**
- Modify: `lib/retention.ts` (`purgeOldConversations`, `expireOldImages`)
- Create: `app/api/cron/retention/route.ts`
- Modify: `vercel.json` (crons entry)
- Modify: `.env.local.example` (`CRON_SECRET`)
- Test: scratchpad `t4-cron.mjs` + a DB seed via `pg` (this test seeds aged rows directly, like `scripts/clean-test.mjs`)

**Interfaces:**
- Consumes: `RETENTION`, `delBlobs`.
- Produces:
  - `purgeOldConversations(): Promise<number>` — deletes conversations with `last_message_at < now - 365d` (cascade messages) after deleting their blobs; returns count.
  - `expireOldImages(): Promise<number>` — for hosted image messages older than 60d: delete blob, blank the row to a placeholder; returns count.
  - `GET /api/cron/retention` — requires `authorization: Bearer <CRON_SECRET>`, returns `{ purgedConversations, expiredImages }`.

- [ ] **Step 1: Write the failing test** — scratchpad `t4-cron.mjs`. It seeds aged rows with `pg` directly (loads `.env.local` like `scripts/clean-test.mjs`), then calls the cron route over HTTP.

```js
import { readFileSync } from "node:fs";
import pg from "pg";
import { randomUUID } from "node:crypto";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split(/\r?\n/)) { const i = l.indexOf("="); if (i>0 && !l.startsWith("#")) process.env[l.slice(0,i).trim()] ??= l.slice(i+1).trim(); }
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const shopId = "mkt_t4_" + randomUUID().slice(0,8);
const custId = randomUUID(); const convOld = randomUUID(); const convNew = randomUUID();
const now = Date.now();
const old = now - 400*24*3600*1000;      // 400 days → conversation purged
const imgOld = now - 70*24*3600*1000;    // 70 days  → image expired
await p.query("INSERT INTO shops (id,name,voice,created_at) VALUES ($1,'t4','',$2)", [shopId, now]);
await p.query("INSERT INTO admins (id,shop_id,username,password_hash,created_at) VALUES ($1,$2,$3,'x',$4)", [randomUUID(), shopId, "mkt_t4_"+shopId.slice(-6), now]);
await p.query("INSERT INTO customers (id,shop_id,channel,line_user_id,display_name,created_at) VALUES ($1,$2,'line','u1','c',$3)", [custId, shopId, now]);
await p.query("INSERT INTO conversations (id,shop_id,customer_id,channel,mode,last_message_at,created_at) VALUES ($1,$2,$3,'line','manual',$4,$4)", [convOld, shopId, custId, old]);
await p.query("INSERT INTO conversations (id,shop_id,customer_id,channel,mode,last_message_at,created_at) VALUES ($1,$2,$3,'line','manual',$4,$4)", [convNew, shopId, custId, now]);
// hosted image message 70 days old in the NEW conversation (blob_key set but fake — del is best-effort)
const imgId = randomUUID();
await p.query("INSERT INTO messages (id,conversation_id,sender,text,created_at,kind,image_url,blob_key) VALUES ($1,$2,'customer','',$3,'image','https://x/y.jpg','chat-images/fake.jpg')", [imgId, convNew, imgOld]);

// call cron WITHOUT secret → 401
const BASE = "http://localhost:3100";
let res = await fetch(BASE + "/api/cron/retention");
const unauth = res.status === 401;
// call WITH secret
res = await fetch(BASE + "/api/cron/retention", { headers: { authorization: "Bearer " + process.env.CRON_SECRET } });
const body = await res.json();

const goneConv = (await p.query("SELECT 1 FROM conversations WHERE id=$1", [convOld])).rowCount === 0;
const imgRow = (await p.query("SELECT kind, blob_key, text FROM messages WHERE id=$1", [imgId])).rows[0];
const imgExpired = imgRow && imgRow.kind === "text" && imgRow.blob_key === null;

// cleanup
await p.query("DELETE FROM shops WHERE id=$1", [shopId]);
await p.end();
console.log(unauth && goneConv && imgExpired ? "PASS" : `FAIL unauth=${unauth} goneConv=${goneConv} imgExpired=${imgExpired} body=${JSON.stringify(body)}`);
```

(Set `CRON_SECRET` in `.env.local` before running.)

- [ ] **Step 2: Run to verify it fails** — route 404s (no Bearer check, no purge) → `FAIL`.

- [ ] **Step 3: Implement** retention functions — append to `lib/retention.ts`:

```ts
const DAY = 24 * 3600 * 1000;

/** ลบบทสนทนาที่เงียบเกิน N วัน (cascade ลบ messages) + ลบไฟล์รูปในนั้น */
export async function purgeOldConversations(): Promise<number> {
  const cutoff = Date.now() - RETENTION.purgeConversationsAfterDays * DAY;
  const convos = await query<{ id: string }>(
    "SELECT id FROM conversations WHERE last_message_at < $1",
    [cutoff],
  );
  if (convos.length === 0) return 0;
  const ids = convos.map((c) => c.id);
  const blobs = await query<{ blob_key: string }>(
    "SELECT blob_key FROM messages WHERE conversation_id = ANY($1) AND blob_key IS NOT NULL",
    [ids],
  );
  await delBlobs(blobs.map((b) => b.blob_key));
  await query("DELETE FROM conversations WHERE id = ANY($1)", [ids]); // messages cascade via FK
  return ids.length;
}

/** รูปที่เราโฮสต์ (blob_key) เก่าเกิน N วัน → ลบไฟล์ เหลือป้ายข้อความ */
export async function expireOldImages(): Promise<number> {
  const cutoff = Date.now() - RETENTION.deleteHostedImagesAfterDays * DAY;
  const rows = await query<{ id: string; blob_key: string }>(
    "SELECT id, blob_key FROM messages WHERE kind = 'image' AND blob_key IS NOT NULL AND created_at < $1",
    [cutoff],
  );
  if (rows.length === 0) return 0;
  await delBlobs(rows.map((r) => r.blob_key));
  await query(
    `UPDATE messages SET kind = 'text', image_url = NULL, blob_key = NULL, text = '🖼️ รูป (หมดอายุ)'
     WHERE id = ANY($1)`,
    [rows.map((r) => r.id)],
  );
  return rows.length;
}
```

- [ ] **Step 4: Implement cron route** `app/api/cron/retention/route.ts`

```ts
import { NextResponse } from "next/server";
import { purgeOldConversations, expireOldImages } from "@/lib/retention";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const purgedConversations = await purgeOldConversations();
  const expiredImages = await expireOldImages();
  return NextResponse.json({ purgedConversations, expiredImages });
}
```

- [ ] **Step 5: Implement cron schedule** — read `vercel.json`, add a top-level `crons` array (keep the existing `functions` region config):

```json
  "crons": [{ "path": "/api/cron/retention", "schedule": "0 19 * * *" }]
```

- [ ] **Step 6: Document env** in `.env.local.example`, near the Blob block:

```
# Vercel Cron ลบแชตเก่า — ตั้งค่าลับอะไรก็ได้ ใช้ยืนยันว่าคนยิง /api/cron/retention คือ Vercel
# (Vercel ส่ง header: Authorization: Bearer <CRON_SECRET> ให้เอง เมื่อมี env นี้)
# CRON_SECRET=ตั้งค่าลับยาวๆ
```

- [ ] **Step 7: Run to verify it passes** — set `CRON_SECRET` locally, rebuild, restart, run `t4-cron.mjs` → `PASS`.

- [ ] **Step 8: Commit**

```bash
git add lib/retention.ts app/api/cron/retention/route.ts vercel.json .env.local.example
git commit -F - <<'EOF'
feat: Vercel Cron ลบบทสนทนาเงียบ >12 เดือน + ลบไฟล์รูปที่โฮสต์ >60 วัน

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 5: AI vision — pass customer images to Claude

**Files:**
- Modify: `lib/types.ts` (`GenerateRequest` += `imageUrls?`)
- Modify: `lib/claude.ts` (`callClaudeRaw` builds content blocks)
- Modify: `lib/prompt.ts` (`buildConversationContext` returns image urls; REPLY_SYSTEM_PROMPT note)
- Modify: `lib/autoReply.ts`, `app/api/line/draft/route.ts`, `app/api/line/choices/route.ts` (pass `imageUrls`)
- Test: scratchpad `t5-vision.mjs` (real Anthropic call — token use is authorised for AI-quality checks)

**Interfaces:**
- Consumes: `getConversation(...).messages[]` with `kind/imageUrl`.
- Produces:
  - `GenerateRequest` gains `imageUrls?: string[]`.
  - `buildConversationContext(customerName, channel, messages)` now reads `messages: { sender; text; kind?: "text"|"image"; imageUrl?: string }[]` and returns `{ text: string; imageUrls: string[] }` (the newest ≤4 image urls from the last 3 customer messages).

- [ ] **Step 1: Write the failing test** — scratchpad `t5-vision.mjs`. Send a clearly-coloured image and assert the AI reply references it.

```js
// <paste BASE/api/signup helper>
const rand = Math.random().toString(36).slice(2, 8);
const user = `mkt_t5_${rand}`;
let r = await signup(user); if (r.status !== 200) { console.log("FAIL signup"); process.exit(1); }
// a solid-red image; ask the AI what colour it is
r = await api("/api/line/simulate", "POST", {
  text: "สินค้าในรูปสีอะไรคะ",
  imageUrl: "https://dummyimage.com/300x300/ff0000/ff0000.png",
});
const cid = r.json.conversationId;
r = await api("/api/line/draft", "POST", { conversationId: cid });
const msg = (r.json?.message ?? "").toLowerCase();
console.log(msg.includes("แดง") || msg.includes("red") ? "PASS" : `FAIL msg=${r.json?.message}`);
```

- [ ] **Step 2: Run to verify it fails** — before implementing, the image isn't sent to Claude; reply won't reliably mention red → `FAIL` (or it defers).

- [ ] **Step 3: Implement — type** in `lib/types.ts`, add to `GenerateRequest`:
```ts
  imageUrls?: string[];
```

- [ ] **Step 4: Implement — `buildConversationContext`** in `lib/prompt.ts`. Change signature + body:

```ts
export function buildConversationContext(
  customerName: string,
  channel: string,
  messages: { sender: "customer" | "admin"; text: string; kind?: "text" | "image"; imageUrl?: string }[],
): { text: string; imageUrls: string[] } {
  const recent = messages.slice(-12);
  const history = recent
    .map((m) => {
      const who = m.sender === "admin" ? "แอดมิน" : "ลูกค้า";
      const body = m.kind === "image" ? `[ส่งรูป]${m.text ? " " + m.text : ""}` : m.text;
      return `${who}: ${body}`;
    })
    .join("\n");
  // เอา url รูปจาก "ลูกค้า" ใน 3 ข้อความล่าสุด สูงสุด 4 รูป
  const imageUrls = messages
    .slice(-3)
    .filter((m) => m.sender === "customer" && m.kind === "image" && m.imageUrl)
    .map((m) => m.imageUrl as string)
    .slice(-4);
  const text = `นี่คือประวัติแชตกับลูกค้า "${customerName}" (ช่องทาง ${channel}):
${history}

แอดมินกำลังจะตอบลูกค้าต่อจากข้อความล่าสุด ร่างข้อความตอบที่พร้อมส่งได้เลย`;
  return { text, imageUrls };
}
```

- [ ] **Step 5: Implement — `callClaudeRaw`** in `lib/claude.ts`. Build content blocks when images exist:

```ts
  const userContent = buildUserContent(req);
  const imgs = req.imageUrls ?? [];
  const content =
    imgs.length === 0
      ? userContent
      : [
          { type: "text", text: userContent },
          ...imgs.map((url) => ({ type: "image", source: { type: "url", url } })),
        ];
  ...
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: "user", content }],
      }),
```

- [ ] **Step 6: Implement — callers.** In `lib/autoReply.ts`, `app/api/line/draft/route.ts`, `app/api/line/choices/route.ts`, `buildConversationContext` now returns an object. Update each call site:

```ts
  const ctx = buildConversationContext(convo.customerName, convo.channel, convo.messages);
  const result = await generateReply({
    shopName: shopData.shop.name,
    shopVoice: shopData.shop.voice,
    shopMemory: shopData.shop.memory,
    products: shopData.products,
    customerMsg: ctx.text,
    imageUrls: ctx.imageUrls,
  });
```
(In `choices` route it is `generateChoices({...})` — same fields.)

- [ ] **Step 7: Implement — prompt note** in `lib/prompt.ts`, append to REPLY_SYSTEM_PROMPT principle list:
```
6. ถ้าลูกค้าแนบรูปมา ให้ดูรูปจริงแล้วตอบให้ตรง (เช่น สี/ลักษณะ/น่าจะเป็นรุ่นไหนเทียบกับสินค้าในคลัง) — แต่ห้ามมั่วสเปก/รุ่นที่ดูจากรูปไม่ออก ถ้าไม่ชัดให้ถามเพิ่มอย่างสุภาพ
```

- [ ] **Step 8: Run to verify it passes** — rebuild, restart, run `t5-vision.mjs` → `PASS`. Clean.

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/claude.ts lib/prompt.ts lib/autoReply.ts app/api/line/draft/route.ts app/api/line/choices/route.ts
git commit -F - <<'EOF'
feat: AI ดูรูปลูกค้าแล้วตอบได้ (ส่งรูปเข้า Claude เฉพาะตอนแชตมีรูป)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 6: LINE image ingest (download → Vercel Blob → message)

**Files:**
- Modify: `lib/lineClient.ts` (`getMessageContent`)
- Modify: `app/api/line/webhook/route.ts` (handle `type:"image"` events)
- Test: scratchpad `t6-line-image.mjs` (FALLBACK path — no blob token; assert placeholder). Real-blob path verified manually with a token (documented).

**Interfaces:**
- Consumes: `isBlobConfigured`, `putImage` from `lib/blobStore.ts`; `ingestCustomerMessage` media fields.
- Produces: `getMessageContent(accessToken: string, messageId: string): Promise<{ buffer: Buffer; contentType: string }>`.

- [ ] **Step 1: Implement `getMessageContent`** in `lib/lineClient.ts`

```ts
/** ดึงไฟล์รูป/มีเดียจาก LINE ตาม messageId (ต้องใช้ access token ของ OA) */
export async function getMessageContent(
  accessToken: string,
  messageId: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LINE content ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}
```

- [ ] **Step 2: Write the failing test** — scratchpad `t6-line-image.mjs`. Drive the webhook with a signed image event; with no blob token, expect a `[ลูกค้าส่งรูป]`/placeholder text message (not a crash). Compute the LINE signature exactly as the webhook verifies it (HMAC-SHA256 base64 of the raw body using the shop's channel secret). This test first connects a mock LINE channel for the shop so `destination`/bot id routes to it — match the existing mock-connect flow in `app/api/line/connect`. If wiring a signed webhook proves impractical in-script, fall back to asserting the unit behaviour by calling a small exported helper; otherwise verify manually. Keep the assertion:

```js
// after driving the webhook image event with NO BLOB_READ_WRITE_TOKEN set:
const text = lastCustomerMessage.text;
console.log(text && /รูป/.test(text) ? "PASS (fallback placeholder)" : `FAIL text=${text}`);
```

- [ ] **Step 3: Run to verify it fails** — before implementing, an image event ingests empty text → `FAIL`.

- [ ] **Step 4: Implement webhook image handling** in `app/api/line/webhook/route.ts`. Where the handler builds the text for a message event, branch on `event.message.type`:

```ts
// inside the per-event loop, for message events:
let kind: "text" | "image" = "text";
let imageUrl: string | undefined;
let blobKey: string | undefined;
let text = "";

if (event.message.type === "text") {
  text = event.message.text ?? "";
} else if (event.message.type === "image") {
  if (isBlobConfigured()) {
    try {
      const { buffer, contentType } = await getMessageContent(accessToken, event.message.id);
      const up = await putImage(buffer, contentType);
      kind = "image";
      imageUrl = up.url;
      blobKey = up.key;
      text = "";
    } catch {
      text = "🖼️ ลูกค้าส่งรูป (เปิดดูในแอป LINE)";
    }
  } else {
    text = "🖼️ ลูกค้าส่งรูป (เปิดดูในแอป LINE)";
  }
} else {
  // sticker/location/etc — keep prior behaviour or a simple placeholder
  text = "[ข้อความที่ยังไม่รองรับ]";
}

const conversationId = await ingestCustomerMessage(shopId, {
  channel: "line",
  lineUserId: userId,
  displayName,
  text,
  extId: event.message.id,
  kind,
  imageUrl,
  blobKey,
});
```
Add imports: `import { isBlobConfigured, putImage } from "@/lib/blobStore";` and `getMessageContent` from `@/lib/lineClient`. `accessToken` is the resolved LINE OA token already used to reply in this handler — reuse it.

- [ ] **Step 5: Run to verify it passes** — rebuild, restart, run `t6-line-image.mjs` (no blob token) → `PASS (fallback placeholder)`. Clean.

- [ ] **Step 6: Commit**

```bash
git add lib/lineClient.ts app/api/line/webhook/route.ts
git commit -F - <<'EOF'
feat: รับรูปจาก LINE → โฮสต์ Vercel Blob (ไม่มี token → ป้ายแทน)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 7: Marketplace image ingest (Facebook / Lazada / Shopee / TikTok)

**Files:**
- Modify: `app/api/facebook/webhook/route.ts` (or wherever FB inbound is handled)
- Modify: `app/api/lazada/webhook/route.ts`
- Modify: `app/api/shopee/webhook/route.ts`
- Modify: `app/api/tiktok/webhook/route.ts`
- Test: `npm run build` + targeted payload-shape check (these webhooks need signed payloads + live accounts; assert via build and a payload-parsing unit assertion where feasible)

**Interfaces:**
- Consumes: `ingestCustomerMessage` media fields.
- Produces: each webhook, when an inbound event carries an image URL, ingests `{ kind:"image", imageUrl:<cdn url>, blobKey: undefined }` (no Blob — marketplaces serve durable CDN URLs).

- [ ] **Step 1: Implement — extract image URL per payload.** For each webhook, locate where the inbound customer message text is extracted and add an image branch. Exact field names per platform:
  - **Facebook**: `messaging[].message.attachments[]` where `type === "image"` → `payload.url`.
  - **Lazada** (`app/api/lazada/webhook/route.ts`, `LzMessage`): image messages carry the URL in `content` (object) — read `content.url`/`content.image_url`; treat a non-empty image url as `kind:"image"`.
  - **Shopee**: inbound message `content.url` for `message_type === "image"`.
  - **TikTok**: inbound IM image content URL field.

For each, when an image URL is found:
```ts
await ingestCustomerMessage(shopId, {
  channel: "<platform>",       // "facebook" | "lazada" | "shopee" | "tiktok"
  lineUserId: userId,
  displayName,
  text: caption ?? "",
  extId: messageId,
  kind: "image",
  imageUrl,                    // CDN url from the payload
});
```
When no image, keep the existing text path unchanged.

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Verify parsing (best-effort unit assertion).** Where a webhook has a pure extractor (e.g. Lazada `textOf`/`userOf`), add/confirm an analogous `imageOf(m)` helper and a scratchpad node assertion that feeds a sample payload object and checks `imageOf` returns the url. (Full end-to-end needs live signed webhooks — verify on the live site once a platform is connected.)

- [ ] **Step 4: Commit**

```bash
git add app/api/facebook/webhook/route.ts app/api/lazada/webhook/route.ts app/api/shopee/webhook/route.ts app/api/tiktok/webhook/route.ts
git commit -F - <<'EOF'
feat: รับรูปจาก FB/Lazada/Shopee/TikTok (เก็บลิงก์ CDN ไม่กิน storage)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Task 8: UI — show image thumbnails in the inbox

**Files:**
- Modify: `app/InboxView.tsx` (message rendering)
- Test: `npm run build` + visual check on the running app

**Interfaces:**
- Consumes: conversation messages with `kind`, `imageUrl` (the conversation-detail API returns them after Task 1).

- [ ] **Step 1: Implement** — in `app/InboxView.tsx`, where each message bubble renders its text, branch on `kind`:

```tsx
{m.kind === "image" && m.imageUrl ? (
  <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
    <img
      src={m.imageUrl}
      alt="รูปจากลูกค้า"
      className="max-h-48 max-w-[12rem] rounded-lg object-cover"
    />
  </a>
) : (
  <span>{m.text}</span>
)}
```
(Match the surrounding bubble markup/classNames — replace only the inner text node. Ensure the InboxView message type includes `kind?: "text"|"image"` and `imageUrl?: string`, mirroring `ChatMessage`.)

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Visual check** — start server, sign in to a `mkt_` shop, simulate an image message (Task 1 path), open the inbox, confirm the thumbnail renders and links to the full image. Clean up.

- [ ] **Step 4: Commit**

```bash
git add app/InboxView.tsx
git commit -F - <<'EOF'
feat: กล่องแชตแสดงรูป thumbnail (คลิกดูเต็ม)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Final step: deploy

- [ ] After all tasks pass, push: `git -c credential.credentialStore=dpapi push origin main` and verify `X..Y main -> main`.
- [ ] In Vercel: add `BLOB_READ_WRITE_TOKEN` (create a Blob store first) and `CRON_SECRET`, then Redeploy so the cron + Blob activate. (Without them: images still work for marketplaces; LINE images show placeholders; cron route returns 401 until `CRON_SECRET` is set.)
