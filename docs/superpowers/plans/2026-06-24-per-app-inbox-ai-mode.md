# Per-App Inbox + AI Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนกล่องแชตเป็นลิสต์แอปที่ผู้ใช้เพิ่มเอง และแยกโหมด AI (off/safe/full) อิสระต่อแอป

**Architecture:** ตารางใหม่ `inbox_apps` เก็บแอปที่ร้านเพิ่ม + โหมดต่อ channel; `ensureConversation`/`processAutoReply` อ่านโหมดจาก channel แทนระดับร้าน; UI หน้ารวมเป็นลิสต์การ์ดแนวตั้ง

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Neon Postgres (pg)

## Global Constraints
- ห้ามทดสอบ write ops บนข้อมูลจริง — ใช้ร้าน prefix `mkt_` แล้วลบทิ้ง (สคริปต์ test ไม่ commit)
- pg-using scripts รันจาก repo root `D:\st`
- โหมด map: `off`→`manual`, `safe`/`full`→`auto`
- channel ที่ถูกต้อง: `line`,`facebook`,`tiktok`,`lazada`,`shopee`
- คง `shops.auto_level`/`/api/line/automode` ไว้ (legacy) ไม่ลบ
- ทุก commit ปิดท้าย `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Data layer — `inbox_apps` table + repo

**Files:**
- Modify: `lib/db.ts` (ensureSchema, หลังบล็อก CREATE TABLE messages)
- Create: `lib/inboxAppsRepo.ts`
- Test: `scripts/test-inbox-apps.mjs` (ไม่ commit)

**Interfaces — Produces:**
- `type InboxApp = { channel: string; level: AutoLevel; sortOrder: number }`
- `isValidLevel(v: string): v is AutoLevel`
- `listInboxApps(shopId): Promise<InboxApp[]>`
- `addInboxApp(shopId, channel): Promise<void>` (idempotent)
- `removeInboxApp(shopId, channel): Promise<void>`
- `getChannelLevel(shopId, channel): Promise<AutoLevel>` (ไม่มีแถว → 'off')
- `setChannelLevel(shopId, channel, level): Promise<void>` (upsert)

- [ ] **Step 1: เพิ่มตารางใน ensureSchema** — ใน `lib/db.ts` เพิ่มต่อจาก `CREATE INDEX ... idx_messages_blob ...` (บรรทัด ~123):

```sql
    -- แอปที่ร้านเพิ่มเข้ากล่องแชต + โหมด AI แยกต่อแอป (off/safe/full)
    CREATE TABLE IF NOT EXISTS inbox_apps (
      shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      channel    TEXT NOT NULL,
      auto_level TEXT NOT NULL DEFAULT 'off',
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (shop_id, channel)
    );
```

- [ ] **Step 2: สร้าง `lib/inboxAppsRepo.ts`**

```ts
import "server-only";
import { query, queryOne } from "./db";
import type { AutoLevel } from "./types";

const VALID_LEVELS: AutoLevel[] = ["off", "safe", "full"];
export function isValidLevel(v: string): v is AutoLevel {
  return (VALID_LEVELS as string[]).includes(v);
}

export type InboxApp = { channel: string; level: AutoLevel; sortOrder: number };

/** แอปที่ร้านเพิ่มไว้ เรียงตามลำดับเพิ่ม */
export async function listInboxApps(shopId: string): Promise<InboxApp[]> {
  const rows = await query<{ channel: string; auto_level: string; sort_order: number }>(
    "SELECT channel, auto_level, sort_order FROM inbox_apps WHERE shop_id = $1 ORDER BY sort_order ASC, channel ASC",
    [shopId],
  );
  return rows.map((r) => ({
    channel: r.channel,
    level: isValidLevel(r.auto_level) ? r.auto_level : "off",
    sortOrder: Number(r.sort_order),
  }));
}

async function nextOrder(shopId: string): Promise<number> {
  const row = await queryOne<{ m: number }>(
    "SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM inbox_apps WHERE shop_id = $1",
    [shopId],
  );
  return (row?.m ?? -1) + 1;
}

/** เพิ่มแอป (default โหมด off) — ซ้ำไม่เป็นไร (idempotent) ใช้ทั้งกดเพิ่มเอง + auto ตอนรับข้อความ */
export async function addInboxApp(shopId: string, channel: string): Promise<void> {
  await query(
    `INSERT INTO inbox_apps (shop_id, channel, auto_level, sort_order)
     VALUES ($1, $2, 'off', $3)
     ON CONFLICT (shop_id, channel) DO NOTHING`,
    [shopId, channel, await nextOrder(shopId)],
  );
}

export async function removeInboxApp(shopId: string, channel: string): Promise<void> {
  await query("DELETE FROM inbox_apps WHERE shop_id = $1 AND channel = $2", [shopId, channel]);
}

export async function getChannelLevel(shopId: string, channel: string): Promise<AutoLevel> {
  const row = await queryOne<{ auto_level: string }>(
    "SELECT auto_level FROM inbox_apps WHERE shop_id = $1 AND channel = $2",
    [shopId, channel],
  );
  return row && isValidLevel(row.auto_level) ? row.auto_level : "off";
}

/** ตั้งโหมดของแอป (สร้างแถวถ้ายังไม่มี) */
export async function setChannelLevel(shopId: string, channel: string, level: AutoLevel): Promise<void> {
  await query(
    `INSERT INTO inbox_apps (shop_id, channel, auto_level, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (shop_id, channel) DO UPDATE SET auto_level = EXCLUDED.auto_level`,
    [shopId, channel, level, await nextOrder(shopId)],
  );
}
```

- [ ] **Step 3: เขียน test script** `scripts/test-inbox-apps.mjs` (โหลด .env.local, สร้างร้าน `mkt_apps_<ts>`, ทดสอบ add/list/setLevel/get/dedupe/remove แล้วลบร้านทิ้ง) — ใช้ pg ตรง (ไม่ import repo เพราะ server-only)
- [ ] **Step 4: รัน** `node scripts/test-inbox-apps.mjs` → คาดว่า PASS ทุกข้อ (add→list มี 1 / setLevel safe→get safe / add ซ้ำ→ยัง 1 แถว / remove→0 แถว)
- [ ] **Step 5: ลบ test script + commit** (`git add lib/db.ts lib/inboxAppsRepo.ts`)

```
feat: ตาราง inbox_apps + repo (แอปต่อร้าน + โหมด AI ต่อแอป)
```

---

### Task 2: Per-channel mode wiring

**Files:**
- Modify: `lib/inboxRepo.ts` (ensureConversation; เพิ่ม setChannelConversationsMode)
- Modify: `lib/autoReply.ts` (processAutoReply ใช้ getChannelLevel)
- Test: `scripts/test-channel-mode.mjs` (ไม่ commit)

**Interfaces — Consumes:** `addInboxApp`, `getChannelLevel` จาก Task 1
**Produces:** `setChannelConversationsMode(shopId, channel, mode): Promise<void>`

- [ ] **Step 1: แก้ `ensureConversation` ใน `lib/inboxRepo.ts`** — เพิ่ม import บนสุด:

```ts
import { addInboxApp, getChannelLevel } from "./inboxAppsRepo";
```

เปลี่ยนตัว body หลัง `if (existing) return existing.id;` จากเดิมที่อ่าน `shops.auto_reply` เป็น:

```ts
  if (existing) return existing.id;
  // กันแชตหาย: ลูกค้าทักในแอปที่ยังไม่เพิ่ม → เพิ่มแอปอัตโนมัติ (โหมด off)
  await addInboxApp(shopId, channel);
  const level = await getChannelLevel(shopId, channel);
  const mode = level === "off" ? "manual" : "auto";
  const id = newId();
  const now = Date.now();
  await query(
    `INSERT INTO conversations (id, shop_id, customer_id, channel, mode, last_message_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, shopId, customerId, channel, mode, now],
  );
  return id;
```

(ลบบล็อก `const shop = await queryOne... auto_reply ...` ออก)

- [ ] **Step 2: เพิ่ม `setChannelConversationsMode`** ใน `lib/inboxRepo.ts` (ถัดจาก `setAllConversationsMode`):

```ts
/** ตั้งโหมดเฉพาะบทสนทนาของ channel นั้น (ใช้ตอนสลับโหมด AI ของแอปเดียว) */
export async function setChannelConversationsMode(
  shopId: string,
  channel: string,
  mode: "manual" | "auto",
): Promise<void> {
  await query(
    "UPDATE conversations SET mode = $1 WHERE shop_id = $2 AND channel = $3",
    [mode, shopId, channel],
  );
}
```

- [ ] **Step 3: แก้ `processAutoReply` ใน `lib/autoReply.ts`** — เพิ่ม import:

```ts
import { getChannelLevel } from "./inboxAppsRepo";
```

ลบ `import { getShopData, getAutoLevel } from "./shopRepo";` → เป็น `import { getShopData } from "./shopRepo";`
เปลี่ยนบรรทัด `const level = await getAutoLevel(shopId);` (หลัง `const convo = await getConversation(...)`) เป็น:

```ts
    const level = await getChannelLevel(shopId, convo.channel);
```

- [ ] **Step 4: เขียน test** `scripts/test-channel-mode.mjs` — สร้างร้าน mkt_, set channel line=safe / facebook=off, สร้าง customer+conversation 2 channel ผ่าน "เลียนแบบ ensureConversation" ด้วย pg ตรง (insert customer + เช็คว่า ถ้าเราจะใช้ logic จริง ต้องผ่าน repo) → ทางง่าย: ทดสอบ `setChannelLevel`+`getChannelLevel` independence (line=safe ไม่ทำ facebook เปลี่ยน) และ `setChannelConversationsMode` อัปเดตเฉพาะ channel เป้าหมาย (insert 2 conversations คนละ channel, เรียก update line→auto, เช็ค facebook ยัง manual). ลบร้านทิ้ง
- [ ] **Step 5: รัน** `node scripts/test-channel-mode.mjs` → PASS (independence + เฉพาะ channel)
- [ ] **Step 6: typecheck** `npx tsc --noEmit` → exit 0
- [ ] **Step 7: ลบ test + commit** (`git add lib/inboxRepo.ts lib/autoReply.ts`)

```
feat: บทสนทนาใหม่+auto-reply อ่านโหมด AI ต่อแอป (channel) แทนระดับร้าน
```

---

### Task 3: API endpoints

**Files:**
- Create: `app/api/inbox/apps/route.ts` (GET/POST/DELETE)
- Create: `app/api/inbox/apps/level/route.ts` (POST)

**Interfaces — Consumes:** repo Task 1 + `setChannelConversationsMode` Task 2 + `processAutoReply`, `listConversations`

- [ ] **Step 1: สร้าง `app/api/inbox/apps/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listInboxApps, addInboxApp, removeInboxApp } from "@/lib/inboxAppsRepo";

export const runtime = "nodejs";

const VALID_CHANNELS = ["line", "facebook", "tiktok", "lazada", "shopee"];

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  return NextResponse.json({ apps: await listInboxApps(admin.shopId) });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  let body: { channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  if (!body.channel || !VALID_CHANNELS.includes(body.channel)) {
    return NextResponse.json({ error: "แพลตฟอร์มไม่ถูกต้อง" }, { status: 400 });
  }
  await addInboxApp(admin.shopId, body.channel);
  return NextResponse.json({ apps: await listInboxApps(admin.shopId) });
}

export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const channel = new URL(request.url).searchParams.get("channel") ?? "";
  await removeInboxApp(admin.shopId, channel);
  return NextResponse.json({ apps: await listInboxApps(admin.shopId) });
}
```

- [ ] **Step 2: สร้าง `app/api/inbox/apps/level/route.ts`**

```ts
import { NextResponse, after } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { setChannelLevel, isValidLevel } from "@/lib/inboxAppsRepo";
import { setChannelConversationsMode, listConversations } from "@/lib/inboxRepo";
import { processAutoReply } from "@/lib/autoReply";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  let body: { channel?: string; level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const channel = body.channel ?? "";
  if (!channel) return NextResponse.json({ error: "ไม่ระบุแอป" }, { status: 400 });
  const level = body.level && isValidLevel(body.level) ? body.level : "off";
  const shopId = admin.shopId;

  await setChannelLevel(shopId, channel, level);
  await setChannelConversationsMode(shopId, channel, level === "off" ? "manual" : "auto");

  // เปิด AI: ตอบข้อความลูกค้าที่ค้างไว้ของแอปนี้ (ข้อความล่าสุดเป็นของลูกค้า)
  if (level !== "off") {
    const convos = await listConversations(shopId);
    const pending = convos.filter((c) => c.channel === channel && c.lastSender === "customer");
    if (pending.length) {
      after(async () => {
        for (const c of pending) await processAutoReply(shopId, c.id, "");
      });
    }
  }

  return NextResponse.json({ channel, level });
}
```

- [ ] **Step 3: build** `npx next build` → exit 0 (เห็น route `/api/inbox/apps` + `/api/inbox/apps/level`)
- [ ] **Step 4: commit** (`git add app/api/inbox/`)

```
feat: API จัดการแอปในกล่องแชต + ตั้งโหมด AI ต่อแอป
```

---

### Task 4: UI — ลิสต์แอปแนวตั้ง + โหมด AI ต่อแอป

**Files:**
- Modify: `app/InboxView.tsx`

**Interfaces — Consumes:** `GET/POST/DELETE /api/inbox/apps`, `POST /api/inbox/apps/level`

- [ ] **Step 1: เพิ่ม type/const ระดับโมดูล** (บนสุดของ InboxView.tsx ใกล้ `const PLATFORMS`):

```tsx
type InboxApp = { channel: string; level: AutoLevel };
let appsCache: InboxApp[] = [];

const LEVEL_OPTIONS: { value: AutoLevel; label: string }[] = [
  { value: "off", label: "✋ กดส่งเอง" },
  { value: "safe", label: "🛡️ ปลอดภัย" },
  { value: "full", label: "⚡ Full auto" },
];
```

- [ ] **Step 2: เปลี่ยน state** ในคอมโพเนนต์ — ลบ `autoLevel`/`autoLevelCache` (state + module cache + effect โหลด /api/line/automode + ฟังก์ชัน `changeLevel` เดิม) แล้วเพิ่ม:

```tsx
  const [apps, setApps] = useState<InboxApp[]>(() => appsCache);

  const loadApps = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/apps");
      if (!r.ok) return;
      const d = (await r.json()) as { apps: InboxApp[] };
      appsCache = d.apps;
      setApps(d.apps);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const levelOf = (channel: string | null): AutoLevel =>
    apps.find((a) => a.channel === channel)?.level ?? "off";

  async function changeLevel(channel: string, next: AutoLevel) {
    if (next === levelOf(channel)) return;
    if (next === "full") {
      const msg =
        "⚡ Full auto: AI จะตอบลูกค้าทุกข้อความเอง แม้แต่ตอนที่ไม่มั่นใจ (เช่น ต่อรองราคา / เคลม / คืนเงิน) ซึ่งอาจตอบผิดได้\n\nยืนยันเปิด Full auto?";
      if (!window.confirm(msg)) return;
    }
    const prev = apps;
    const optimistic = apps.map((a) => (a.channel === channel ? { ...a, level: next } : a));
    setApps(optimistic);
    appsCache = optimistic;
    try {
      await fetch("/api/inbox/apps/level", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, level: next }),
      });
    } catch {
      setApps(prev);
      appsCache = prev;
      return;
    }
    void loadConversations();
    if (activeIdRef.current) void loadDetail(activeIdRef.current);
  }

  async function addApp(channel: string) {
    try {
      const r = await fetch("/api/inbox/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (r.ok) {
        const d = (await r.json()) as { apps: InboxApp[] };
        appsCache = d.apps;
        setApps(d.apps);
      }
    } catch {
      /* เงียบไว้ */
    }
  }

  async function removeApp(channel: string) {
    if (!window.confirm("ลบแอปนี้ออกจากกล่องแชต? (แชต/การเชื่อมต่อไม่หาย เพิ่มกลับมาได้)")) return;
    try {
      const r = await fetch(`/api/inbox/apps?channel=${encodeURIComponent(channel)}`, {
        method: "DELETE",
      });
      if (r.ok) {
        const d = (await r.json()) as { apps: InboxApp[] };
        appsCache = d.apps;
        setApps(d.apps);
      }
    } catch {
      /* เงียบไว้ */
    }
  }
```

- [ ] **Step 3: แก้ header select ในหน้าแชต** — เปลี่ยน `<select value={autoLevel} onChange={...changeLevel(e.target.value)}>` เป็น (ใช้ `LEVEL_OPTIONS` + channel ปัจจุบัน):

```tsx
            <select
              value={levelOf(selectedPlatform)}
              onChange={(e) =>
                selectedPlatform && void changeLevel(selectedPlatform, e.target.value as AutoLevel)
              }
              aria-label="ระดับการตอบของ AI"
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
```

- [ ] **Step 4: เปลี่ยนหน้ารวม** — แทน `<PlatformHub conversations={conversations} onPick={pickPlatform} />` ด้วย:

```tsx
        <AppList
          apps={apps}
          conversations={conversations}
          onPick={pickPlatform}
          onChangeLevel={changeLevel}
          onAddApp={addApp}
          onRemoveApp={removeApp}
        />
```

- [ ] **Step 5: แทนคอมโพเนนต์ `PlatformHub` ด้วย `AppList`** (ท้ายไฟล์):

```tsx
/** กล่องแชต: ลิสต์แอปที่ร้านเพิ่มเอง (การ์ด 2 บรรทัด) + ปุ่มเพิ่ม/ลบ + โหมด AI ต่อแอป */
function AppList({
  apps,
  conversations,
  onPick,
  onChangeLevel,
  onAddApp,
  onRemoveApp,
}: {
  apps: { channel: string; level: AutoLevel }[];
  conversations: ConversationSummary[];
  onPick: (channel: string) => void;
  onChangeLevel: (channel: string, level: AutoLevel) => void;
  onAddApp: (channel: string) => void;
  onRemoveApp: (channel: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const addedChannels = new Set(apps.map((a) => a.channel));
  const available = PLATFORMS.filter((p) => !addedChannels.has(p.channel));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">กล่องแชต</h2>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          เพิ่มแอปที่ใช้ แล้วตั้งโหมด AI แยกแต่ละแอปได้
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">ยังไม่มีแอป — เริ่มด้วยการเพิ่มแอปที่คุณใช้</p>
          <AddAppButton available={available} adding={adding} setAdding={setAdding} onAddApp={onAddApp} />
        </div>
      ) : (
        <div className="space-y-2">
          {apps.map((a) => {
            const def = PLATFORMS.find((p) => p.channel === a.channel);
            const convos = conversations.filter((c) => c.channel === a.channel);
            const pending = convos.filter((c) => c.pendingHuman).length;
            return (
              <div
                key={a.channel}
                className="group relative rounded-2xl border border-gray-200 bg-white p-3 transition hover:border-emerald-400 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-emerald-600"
              >
                <button
                  type="button"
                  onClick={() => onPick(a.channel)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${def?.iconBg ?? "bg-gray-400"}`}>
                    {def ? <def.Glyph /> : null}
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-base font-semibold text-gray-900 dark:text-white">{def?.name ?? a.channel}</span>
                      {pending > 0 && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          รอตอบ {pending}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{convos.length} บทสนทนา</span>
                  </span>
                </button>
                <div className="mt-2 flex items-center gap-2 pl-13">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">โหมด AI:</span>
                  <select
                    value={a.level}
                    onChange={(e) => onChangeLevel(a.channel, e.target.value as AutoLevel)}
                    aria-label={`โหมด AI ของ ${def?.name ?? a.channel}`}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveApp(a.channel)}
                  aria-label="ลบแอปออกจากกล่องแชต"
                  className="absolute right-2 top-2 hidden rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600 group-hover:block dark:hover:bg-red-950/30"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <AddAppButton available={available} adding={adding} setAdding={setAdding} onAddApp={onAddApp} />
        </div>
      )}
    </div>
  );
}

/** ปุ่ม ➕ เพิ่มแอป + เมนูเลือกแอปที่ยังไม่ได้เพิ่ม */
function AddAppButton({
  available,
  adding,
  setAdding,
  onAddApp,
}: {
  available: PlatformDef[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  onAddApp: (channel: string) => void;
}) {
  if (available.length === 0) return null;
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex w-full items-center justify-center gap-1 rounded-2xl border border-dashed border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-500 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-gray-700 dark:text-gray-400"
      >
        ➕ เพิ่มแอป
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-gray-200 p-2 dark:border-gray-800">
      <p className="mb-1 px-1 text-[11px] text-gray-400">เลือกแอปที่จะเพิ่ม</p>
      <div className="flex flex-wrap gap-2">
        {available.map((p) => (
          <button
            key={p.channel}
            type="button"
            onClick={() => {
              onAddApp(p.channel);
              setAdding(false);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-700 transition hover:border-emerald-400 dark:border-gray-700 dark:text-gray-200"
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded text-white ${p.iconBg}`}>
              <p.Glyph small />
            </span>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: build** `npx next build` → exit 0
- [ ] **Step 7: commit** (`git add app/InboxView.tsx`)

```
feat: กล่องแชตเป็นลิสต์แอป (เพิ่ม/ลบเอง) + โหมด AI แยกต่อแอป
```

---

## Self-Review notes
- Spec coverage: ตาราง+repo (T1) ✓, ensureConversation+autoReply+setChannelConversationsMode (T2) ✓, API (T3) ✓, UI ลิสต์การ์ด+เพิ่ม/ลบ+โหมดต่อแอป+empty state (T4) ✓
- Type consistency: `InboxApp` ใช้ตรงกัน; `levelOf`/`changeLevel(channel, level)` ตรงกับ AppList props; `LEVEL_OPTIONS` ใช้ซ้ำ 2 ที่
- legacy `/api/line/automode` คงไว้ ไม่ลบ (กันพัง) — เลิกใช้ใน InboxView เท่านั้น
