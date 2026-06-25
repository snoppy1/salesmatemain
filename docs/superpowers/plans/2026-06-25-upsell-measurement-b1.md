# Upsell Measurement B1 (Offered) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every AI upsell that is actually auto-sent to a customer, and show the seller a dashboard tile "AI เสนอพ่วง (ส่งแล้ว): N ครั้ง · ฿X เดือนนี้".

**Architecture:** Stop discarding the model's `should_upsell`/`est_added_value`, add `upsell_product`, and capture an `upsell_events` row in the auto-reply path right after a reply is sent. A metrics endpoint sums the current month; a small client tile shows it. Mock-friendly, best-effort (never breaks a reply).

**Tech Stack:** Next.js 16 + TypeScript, Postgres (Neon) via `pg`, Anthropic `claude-sonnet-4-6`, vitest.

## Global Constraints

- **Best-effort capture:** recording an upsell event must never block or fail the customer reply (wrap in try/catch, swallow). (spec §6)
- **Count only on actual send:** events are recorded in the auto-send path (covers AI modes `safe`/`full`). Manual draft→admin-send capture is **out of scope for B1** (needs per-channel send + frontend plumbing) — see Out of Scope. (spec §4.2)
- **Honest label:** the tile says "เสนอพ่วง (ส่งแล้ว)" — offered, not sold. (spec §2)
- **No destructive tests on real data:** DB integration uses a throwaway `mkt_` shop, deleted after.
- **Period = current calendar month, Thai time (UTC+7).** Model: `claude-sonnet-4-6`.

---

## File Structure

**New:**
- `lib/upsellRepo.ts` — `monthStart` (pure), `recordUpsell`, `upsellSummary`.
- `app/api/metrics/upsell/route.ts` — GET current-month upsell summary.
- `components/UpsellMetric.tsx` — client tile that fetches + renders the metric.
- `scripts/test-upsell.mjs` — throwaway-shop DB round-trip.
- `test/replyResult.test.ts`, `test/upsellPeriod.test.ts` — unit tests.

**Modified:**
- `lib/prompt.ts` — add `upsell_product` to `REPLY_SYSTEM_PROMPT` output JSON.
- `lib/claude.ts` — extend `ReplyResult`; add pure `parseReplyResult`; use it in `generateReply` + `generateReplyWithTools`.
- `lib/db.ts` — add `upsell_events` table + index to `ensureSchema()`.
- `lib/autoReply.ts` — record an upsell event after a sent reply.
- `app/Dashboard.tsx` — mount `<UpsellMetric />` above the inbox.

**Shared interfaces:**

```ts
// lib/claude.ts
export type ReplyResult = {
  message: string;
  needsHuman: boolean;
  reason: string;
  shouldUpsell: boolean;
  estAddedValue: number | null;
  upsellProduct: string;
};
export function parseReplyResult(obj: Record<string, unknown>): ReplyResult;

// lib/upsellRepo.ts
export function monthStart(now: number, tzOffsetHours?: number): number;
export function recordUpsell(e: {
  shopId: string; conversationId: string; channel: string; product: string; estValue: number | null;
}): Promise<void>;
export function upsellSummary(shopId: string, sinceMs: number): Promise<{ count: number; totalEstValue: number }>;
```

---

## Task 1: Extend ReplyResult + prompt + pure parser

**Files:**
- Modify: `lib/prompt.ts`, `lib/claude.ts`
- Create: `test/replyResult.test.ts`

**Interfaces:**
- Produces: extended `ReplyResult`, `parseReplyResult(obj)`.

- [ ] **Step 1: Add `upsell_product` to the reply prompt**

In `lib/prompt.ts`, in `REPLY_SYSTEM_PROMPT`, change the final JSON spec line to add the field:

Old:
```
{"should_upsell": true/false (ข้อความนี้มีการเสนอสินค้าเสริมไหม), "needs_human": true/false, "message": "ข้อความตอบลูกค้าพร้อมส่ง (ห้ามว่าง)", "reason_for_admin": "บริบท/เหตุผลสั้นๆ ให้แอดมิน (ลูกค้าไม่เห็น)", "est_added_value": ตัวเลขบาทของส่วนที่เสนอเพิ่ม หรือ null}`;
```
New:
```
{"should_upsell": true/false (ข้อความนี้มีการเสนอสินค้าเสริมไหม), "needs_human": true/false, "message": "ข้อความตอบลูกค้าพร้อมส่ง (ห้ามว่าง)", "reason_for_admin": "บริบท/เหตุผลสั้นๆ ให้แอดมิน (ลูกค้าไม่เห็น)", "est_added_value": ตัวเลขบาทของส่วนที่เสนอเพิ่ม หรือ null, "upsell_product": "ชื่อสินค้าที่เสนอพ่วง หรือ \"\" ถ้าไม่ได้เสนอ"}`;
```

- [ ] **Step 2: Write the failing test**

Create `test/replyResult.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseReplyResult } from "@/lib/claude";

describe("parseReplyResult", () => {
  it("maps all fields incl. upsell", () => {
    const r = parseReplyResult({
      message: "x", needs_human: false, reason_for_admin: "r",
      should_upsell: true, est_added_value: 120, upsell_product: "เคส",
    });
    expect(r).toEqual({
      message: "x", needsHuman: false, reason: "r",
      shouldUpsell: true, estAddedValue: 120, upsellProduct: "เคส",
    });
  });
  it("defaults missing fields", () => {
    expect(parseReplyResult({})).toEqual({
      message: "", needsHuman: false, reason: "",
      shouldUpsell: false, estAddedValue: null, upsellProduct: "",
    });
  });
  it("treats non-number est_added_value as null", () => {
    expect(parseReplyResult({ est_added_value: "abc" }).estAddedValue).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/replyResult.test.ts`
Expected: FAIL — `parseReplyResult` not exported from `@/lib/claude`.

- [ ] **Step 4: Extend `ReplyResult` + add `parseReplyResult` + use it**

In `lib/claude.ts`, replace the `ReplyResult` type:

```ts
/** ผลลัพธ์การร่างคำตอบแชต (auto/draft) */
export type ReplyResult = {
  message: string;
  needsHuman: boolean;
  reason: string;
  shouldUpsell: boolean;
  estAddedValue: number | null;
  upsellProduct: string;
};

/** แปลง JSON ดิบจากโมเดล → ReplyResult (pure, เทสต์ได้) */
export function parseReplyResult(obj: Record<string, unknown>): ReplyResult {
  const ev = obj.est_added_value;
  return {
    message: typeof obj.message === "string" ? obj.message : "",
    needsHuman: Boolean(obj.needs_human),
    reason: typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
    shouldUpsell: Boolean(obj.should_upsell),
    estAddedValue: typeof ev === "number" && Number.isFinite(ev) ? ev : null,
    upsellProduct: typeof obj.upsell_product === "string" ? obj.upsell_product : "",
  };
}
```

Then change `generateReply` to use it:

```ts
export async function generateReply(req: GenerateRequest): Promise<ReplyResult> {
  const obj = await callClaudeRaw(REPLY_SYSTEM_PROMPT, req);
  return parseReplyResult(obj);
}
```

And in `generateReplyWithTools`, replace the two `return` statements at the end with parser-based ones:

```ts
  let obj: Record<string, unknown> = {};
  try {
    obj = parseModelJson(finalText) as Record<string, unknown>;
  } catch {
    // โมเดลตอบเป็นข้อความล้วน (เช่น ถามเลขออเดอร์) → ไม่ถือเป็นการพ่วง
    return { message: finalText.trim(), needsHuman: false, reason: "", shouldUpsell: false, estAddedValue: null, upsellProduct: "" };
  }
  const parsed = parseReplyResult(obj);
  // order path: ถ้าไม่มี message ใน JSON ให้ fallback เป็น finalText
  return { ...parsed, message: parsed.message || finalText.trim() };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/replyResult.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 6: Type-check (callers use the wider type)**

Run: `npx next build`
Expected: `Compiled successfully` (draft/choices/autoReply already destructure only `message`/`needsHuman` — wider type is compatible).

- [ ] **Step 7: Commit**

```bash
git add lib/prompt.ts lib/claude.ts test/replyResult.test.ts
git commit -m "feat: capture should_upsell/est_added_value/upsell_product in ReplyResult"
```

---

## Task 2: upsell_events table + repo + monthStart

**Files:**
- Modify: `lib/db.ts`
- Create: `lib/upsellRepo.ts`, `test/upsellPeriod.test.ts`, `scripts/test-upsell.mjs`

**Interfaces:**
- Consumes: `query`, `queryOne` from `lib/db.ts`; `newId` from `lib/auth.ts`.
- Produces: `monthStart`, `recordUpsell`, `upsellSummary`.

- [ ] **Step 1: Add the table to the schema**

In `lib/db.ts`, inside `ensureSchema()`, immediately before `CREATE INDEX IF NOT EXISTS idx_rules_shop ON rules(shop_id);`, add:

```sql
    -- เหตุการณ์ "AI เสนอพ่วงและส่งถึงลูกค้า" (วัดยอดพ่วง) — คอลัมน์ sold/* เผื่อ B3
    CREATE TABLE IF NOT EXISTS upsell_events (
      id               TEXT PRIMARY KEY,
      shop_id          TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      conversation_id  TEXT NOT NULL,
      channel          TEXT NOT NULL DEFAULT '',
      product          TEXT NOT NULL DEFAULT '',
      est_value        INTEGER,
      created_at       BIGINT NOT NULL,
      sold             BOOLEAN NOT NULL DEFAULT false,
      sold_value       INTEGER,
      matched_order_id TEXT
    );

```

And add the index next to the others, after `idx_promotions_shop`:

```sql
    CREATE INDEX IF NOT EXISTS idx_upsell_events_shop ON upsell_events(shop_id);
```

- [ ] **Step 2: Write the failing test (pure period helper)**

Create `test/upsellPeriod.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { monthStart } from "@/lib/upsellRepo";

describe("monthStart (UTC+7)", () => {
  it("returns the 1st of the current month at 00:00 Thai time", () => {
    const now = Date.UTC(2026, 5, 15, 12, 0, 0); // 15 มิ.ย. 2026 12:00 UTC
    expect(monthStart(now)).toBe(Date.UTC(2026, 5, 1) - 7 * 3600_000);
  });
  it("a moment just after a Thai month start stays in the new month", () => {
    // 1 มิ.ย. 2026 01:00 +07 = 31 พ.ค. 18:00 UTC
    const now = Date.UTC(2026, 4, 31, 18, 0, 0);
    expect(monthStart(now)).toBe(Date.UTC(2026, 5, 1) - 7 * 3600_000);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/upsellPeriod.test.ts`
Expected: FAIL — cannot resolve `@/lib/upsellRepo`.

- [ ] **Step 4: Implement the repo**

Create `lib/upsellRepo.ts`:

```ts
import "server-only";
import { query, queryOne } from "./db";
import { newId } from "./auth";

/** ต้นเดือนปัจจุบันเป็น epoch ms (อิงเวลาไทย UTC+7) */
export function monthStart(now: number, tzOffsetHours = 7): number {
  const shifted = new Date(now + tzOffsetHours * 3600_000);
  const localMonthStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1, 0, 0, 0);
  return localMonthStart - tzOffsetHours * 3600_000;
}

/** บันทึก 1 เหตุการณ์การพ่วงที่ส่งถึงลูกค้าแล้ว */
export async function recordUpsell(e: {
  shopId: string; conversationId: string; channel: string; product: string; estValue: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO upsell_events (id, shop_id, conversation_id, channel, product, est_value, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId(), e.shopId, e.conversationId, e.channel, e.product, e.estValue, Date.now()],
  );
}

/** สรุปจำนวนครั้ง + มูลค่ารวมที่เสนอพ่วง ตั้งแต่ sinceMs */
export async function upsellSummary(
  shopId: string,
  sinceMs: number,
): Promise<{ count: number; totalEstValue: number }> {
  const row = await queryOne<{ count: number; total: number | null }>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(est_value),0)::int AS total
       FROM upsell_events WHERE shop_id = $1 AND created_at >= $2`,
    [shopId, sinceMs],
  );
  return { count: Number(row?.count ?? 0), totalEstValue: Number(row?.total ?? 0) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/upsellPeriod.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 6: Write the DB integration smoke test**

Create `scripts/test-upsell.mjs`:

```js
// สโมกเทสต์ upsell_events: ร้านชั่วคราว mkt_upselltest → insert 2 แถว → สรุปยอด → ลบทิ้ง (cascade)
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const shopId = randomUUID();
const now = Date.now();
try {
  await p.query(`
    CREATE TABLE IF NOT EXISTS upsell_events (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL, channel TEXT NOT NULL DEFAULT '', product TEXT NOT NULL DEFAULT '',
      est_value INTEGER, created_at BIGINT NOT NULL, sold BOOLEAN NOT NULL DEFAULT false,
      sold_value INTEGER, matched_order_id TEXT );
  `);
  await p.query("INSERT INTO shops (id, name, voice, created_at) VALUES ($1,'mkt_upselltest','',$2)", [shopId, now]);
  for (const v of [120, 80]) {
    await p.query(
      `INSERT INTO upsell_events (id, shop_id, conversation_id, channel, product, est_value, created_at)
       VALUES ($1,$2,'c1','line','เคส',$3,$4)`,
      [randomUUID(), shopId, v, now],
    );
  }
  const r = await p.query(
    "SELECT COUNT(*)::int AS count, COALESCE(SUM(est_value),0)::int AS total FROM upsell_events WHERE shop_id=$1",
    [shopId],
  );
  if (Number(r.rows[0].count) === 2 && Number(r.rows[0].total) === 200) {
    console.log("PASS: upsell summary ok (2 / 200)");
  } else {
    console.log("FAIL", r.rows[0]); process.exitCode = 1;
  }
} finally {
  await p.query("DELETE FROM shops WHERE id = $1", [shopId]);
  await p.end();
}
```

- [ ] **Step 7: Run the smoke test**

Run: `node scripts/test-upsell.mjs`
Expected: prints `PASS: upsell summary ok (2 / 200)`.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts lib/upsellRepo.ts test/upsellPeriod.test.ts scripts/test-upsell.mjs
git commit -m "feat: upsell_events table + repo (recordUpsell, upsellSummary, monthStart)"
```

---

## Task 3: Capture on auto-send

**Files:**
- Modify: `lib/autoReply.ts`

**Interfaces:**
- Consumes: `recordUpsell` from `lib/upsellRepo.ts`; `ReplyResult` fields `shouldUpsell`, `estAddedValue`, `upsellProduct`.

- [ ] **Step 1: Import the recorder**

In `lib/autoReply.ts`, add near the other imports:

```ts
import { recordUpsell } from "./upsellRepo";
```

- [ ] **Step 2: Record the event after the reply is sent**

In `lib/autoReply.ts`, find this line:

```ts
    await addAdminMessage(shopId, conversationId, result.message); // เคลียร์ pending ด้วย
```

Immediately after it, add:

```ts
    // วัดยอดพ่วง: บันทึกเมื่อ AI เสนอพ่วงและส่งถึงลูกค้าแล้ว (best-effort ห้ามทำให้ตอบแชตพัง)
    if (result.shouldUpsell && result.estAddedValue != null) {
      await recordUpsell({
        shopId,
        conversationId,
        channel: convo.channel,
        product: result.upsellProduct,
        estValue: result.estAddedValue,
      }).catch(() => {});
    }
```

- [ ] **Step 3: Type-check + full unit suite**

Run: `npx vitest run`
Expected: all tests pass.

Run: `npx next build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add lib/autoReply.ts
git commit -m "feat: record upsell event when AI auto-sends an upsell"
```

---

## Task 4: Metrics API + dashboard tile

**Files:**
- Create: `app/api/metrics/upsell/route.ts`, `components/UpsellMetric.tsx`
- Modify: `app/Dashboard.tsx`

**Interfaces:**
- Consumes: `getCurrentAdmin` (auth); `upsellSummary`, `monthStart` (upsellRepo).

- [ ] **Step 1: Create the metrics endpoint**

Create `app/api/metrics/upsell/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { upsellSummary, monthStart } from "@/lib/upsellRepo";

export const runtime = "nodejs";

// สรุปยอดพ่วงที่ AI เสนอ (และส่งแล้ว) เดือนนี้
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const summary = await upsellSummary(admin.shopId, monthStart(Date.now()));
  return NextResponse.json(summary);
}
```

- [ ] **Step 2: Create the tile component**

Create `components/UpsellMetric.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

export default function UpsellMetric() {
  const [data, setData] = useState<{ count: number; totalEstValue: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics/upsell")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.count === "number") setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.count === 0) return null;

  return (
    <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
      เดือนนี้ AI เสนอพ่วง (ส่งแล้ว){" "}
      <b>{data.count}</b> ครั้ง · มูลค่า <b>฿{data.totalEstValue.toLocaleString()}</b>
    </div>
  );
}
```

- [ ] **Step 3: Mount the tile above the inbox**

In `app/Dashboard.tsx`, add the import after the `InboxView` import (line 19):

```ts
import UpsellMetric from "@/components/UpsellMetric";
```

Then replace this line:

```tsx
          {view === "inbox" && <InboxView mockSettings={mockSettings} />}
```

with:

```tsx
          {view === "inbox" && (
            <>
              <UpsellMetric />
              <InboxView mockSettings={mockSettings} />
            </>
          )}
```

- [ ] **Step 4: Type-check + build**

Run: `npx next build`
Expected: `Compiled successfully` — route `ƒ /api/metrics/upsell` appears in the route list.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, log into a test shop, set a channel's AI mode to `full`, simulate a customer message that triggers an upsell, then load the dashboard inbox — the tile shows "AI เสนอพ่วง (ส่งแล้ว) N ครั้ง · ฿X". (If the AI didn't upsell, the tile stays hidden — `count === 0`.)

- [ ] **Step 6: Commit**

```bash
git add app/api/metrics/upsell/route.ts components/UpsellMetric.tsx app/Dashboard.tsx
git commit -m "feat: upsell metric API + dashboard tile (เสนอพ่วง this month)"
```

---

## Out of Scope (this plan — B1)
- **Manual draft→admin-send capture:** recording upsells the admin sends from an AI draft (needs the 5 per-channel send routes + frontend to forward the draft's `upsellProduct`/`estAddedValue`). Deferred; B1 measures auto-sent upsells (AI modes safe/full).
- **Choices-path upsell capture.**
- **B3 (sold attribution) + Lazada sales total** — separate Plan B (the `sold`/`sold_value`/`matched_order_id` columns are created here, ready for it).
```
