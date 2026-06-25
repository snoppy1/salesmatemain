# Lazada Promotions → AI Recommends Real Promos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull active promotions from Lazada into the shop's data and feed only the currently-valid ones into the AI prompt, so the AI recommends real, in-condition promotions (never invented ones).

**Architecture:** Promotions are shop-level data (not per-customer), so they follow the same "pre-fetch into context" pattern the product catalog already uses — no tool-calling needed. A new `promotions` table + sync endpoint stores them; the prompt builder injects the valid ones; prompt rules constrain the AI to recommend only from that list. Mock-first, so it works in demo before the real Lazada Promotion API permission is confirmed.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Postgres (Neon) via `pg`, Anthropic `claude-sonnet-4-6`, **vitest** (added here) for unit tests.

## Global Constraints

- **Mock-first:** every new Lazada call has a mock fallback (mirrors `lib/marketplace.ts` `isLazadaConfigured()` + `accessToken.startsWith("mock")`). Real API used only when configured AND token is non-mock.
- **Read-only:** the promotion fetch is a GET. No write operations against Lazada.
- **No destructive tests on real data:** integration scripts use a throwaway shop with username/name prefixed `mkt_`, deleted after (cascade).
- **Thai-language, no emoji** in any AI-facing copy/prompt (matches existing prompt rules).
- **Model:** `claude-sonnet-4-6` (unchanged).
- **Promotion API access is NOT yet confirmed** on Lazada for this seller app — until confirmed the real branch may return `[]`; mock + (future) manual entry cover the gap. Do not block on it.

---

## File Structure

**New:**
- `vitest.config.ts` — test runner config (stubs `server-only`, aliases `@` → repo root).
- `test/stubs/server-only.ts` — empty module so server-only imports load under vitest.
- `test/sanity.test.ts` — proves the harness runs (Task 1 only).
- `test/promotions.test.ts` — unit tests for validity filters.
- `test/lazadaPromotions.test.ts` — unit tests for the Lazada parser + mock fetch.
- `test/prompt.test.ts` — unit tests for the promotions prompt block.
- `lib/promotions.ts` — **pure** validity filters (`isPromotionValidNow`, `validNowPromotions`). No `server-only`.
- `lib/lazadaPromotions.ts` — `fetchPromotions(token)` (mock-first) + `parseLazadaPromotions(raw)`.
- `lib/promotionsRepo.ts` — `listPromotions(shopId)`, `replacePromotions(shopId, promos)`.
- `app/api/promotions/sync/route.ts` — POST: fetch from Lazada → store → return.
- `scripts/test-promotions.mjs` — throwaway-shop DB round-trip smoke test.

**Modified:**
- `lib/types.ts` — add `Promotion` type; add `promotions?: Promotion[]` to `GenerateRequest`.
- `lib/db.ts` — add `promotions` table + index to `ensureSchema()`.
- `lib/prompt.ts` — render a `[โปรโมชั่นที่ใช้ได้ตอนนี้]` block in `buildUserContent`; add a promotion rule to `REPLY_SYSTEM_PROMPT` and `CHOICES_SYSTEM_PROMPT`.
- `lib/autoReply.ts` — load valid promos, pass to `generateReply`.
- `app/api/line/draft/route.ts` — load valid promos, pass to `generateReply`.
- `app/api/line/choices/route.ts` — load valid promos, pass to `generateChoices`.

**Shared interfaces (defined once, used across tasks):**

```ts
// lib/types.ts
export type Promotion = {
  id: string;
  title: string;            // ชื่อโปร เช่น "ซื้อ 2 ลด 50"
  type: string;             // "percent" | "fixed" | "code" | "bundle" | ...
  conditionsText: string;   // เงื่อนไขแบบอ่านรู้เรื่องให้ AI
  minSpend: number | null;  // ยอดขั้นต่ำ (บาท) — null = ไม่มี
  productScope: string;     // "" = ทุกชิ้น; ไม่ว่าง = ชื่อ/คีย์เวิร์ดสินค้าที่ใช้ได้
  code: string;             // โค้ดส่วนลด ("" ถ้าไม่มี)
  startsAt: number | null;  // epoch ms; null = ไม่จำกัดเริ่ม
  endsAt: number | null;    // epoch ms; null = ไม่จำกัดสิ้นสุด
  source: string;           // "lazada" | "manual"
};

// lib/promotions.ts
export function isPromotionValidNow(p: Promotion, now: number): boolean;
export function validNowPromotions(promos: Promotion[], now: number): Promotion[];

// lib/lazadaPromotions.ts
export function parseLazadaPromotions(raw: Record<string, unknown>): Promotion[];
export function fetchPromotions(accessToken: string): Promise<Promotion[]>;

// lib/promotionsRepo.ts
export function listPromotions(shopId: string): Promise<Promotion[]>;
export function replacePromotions(shopId: string, promos: Promotion[]): Promise<void>;
```

---

## Task 1: Test harness (vitest)

**Files:**
- Create: `vitest.config.ts`, `test/stubs/server-only.ts`, `test/sanity.test.ts`
- Modify: `package.json` (add `test` script + `vitest` devDependency)

**Interfaces:**
- Produces: a working `npx vitest run` that can import `@/lib/*` files (with `server-only` stubbed).

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: `vitest` appears under `devDependencies` in `package.json`; no errors.

- [ ] **Step 2: Create the server-only stub**

Create `test/stubs/server-only.ts`:

```ts
// vitest loads this in place of the real "server-only" package, which throws
// when imported outside a React Server Component. Tests run plain Node.
export {};
```

- [ ] **Step 3: Create the vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add the test script**

In `package.json`, add to `"scripts"`:

```json
    "test": "vitest run"
```

- [ ] **Step 5: Write a sanity test**

Create `test/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx vitest run`
Expected: PASS — `1 passed`.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts test/stubs/server-only.ts test/sanity.test.ts package.json package-lock.json
git commit -m "test: add vitest harness (server-only stub + @ alias)"
```

---

## Task 2: Promotion type + validity filters (pure)

**Files:**
- Modify: `lib/types.ts` (add `Promotion`)
- Create: `lib/promotions.ts`, `test/promotions.test.ts`

**Interfaces:**
- Produces: `Promotion` (type), `isPromotionValidNow(p, now)`, `validNowPromotions(promos, now)`.

- [ ] **Step 1: Write the failing test**

Create `test/promotions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPromotionValidNow, validNowPromotions } from "@/lib/promotions";
import type { Promotion } from "@/lib/types";

const NOW = 1_700_000_000_000;

function promo(over: Partial<Promotion> = {}): Promotion {
  return {
    id: "p1", title: "ลด 10%", type: "percent", conditionsText: "",
    minSpend: null, productScope: "", code: "",
    startsAt: null, endsAt: null, source: "lazada", ...over,
  };
}

describe("isPromotionValidNow", () => {
  it("no time bounds → valid", () => {
    expect(isPromotionValidNow(promo(), NOW)).toBe(true);
  });
  it("before start → invalid", () => {
    expect(isPromotionValidNow(promo({ startsAt: NOW + 1000 }), NOW)).toBe(false);
  });
  it("after end → invalid", () => {
    expect(isPromotionValidNow(promo({ endsAt: NOW - 1000 }), NOW)).toBe(false);
  });
  it("within window → valid", () => {
    expect(isPromotionValidNow(promo({ startsAt: NOW - 1000, endsAt: NOW + 1000 }), NOW)).toBe(true);
  });
});

describe("validNowPromotions", () => {
  it("keeps only valid ones", () => {
    const list = [promo({ id: "a" }), promo({ id: "b", endsAt: NOW - 1 })];
    expect(validNowPromotions(list, NOW).map((p) => p.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Add the `Promotion` type**

In `lib/types.ts`, add after the `Product` type (around line 25):

```ts
/** โปรโมชั่นระดับร้าน (sync มาจาก Lazada หรือพิมพ์เอง) ที่ AI ใช้แนะนำลูกค้า */
export type Promotion = {
  id: string;
  title: string;            // ชื่อโปร เช่น "ซื้อ 2 ลด 50"
  type: string;             // percent | fixed | code | bundle | ...
  conditionsText: string;   // เงื่อนไขแบบอ่านรู้เรื่องให้ AI
  minSpend: number | null;  // ยอดขั้นต่ำ (บาท) — null = ไม่มี
  productScope: string;     // "" = ทุกชิ้น; ไม่ว่าง = ชื่อ/คีย์เวิร์ดสินค้าที่ใช้ได้
  code: string;             // โค้ดส่วนลด ("" ถ้าไม่มี)
  startsAt: number | null;  // epoch ms; null = ไม่จำกัดเริ่ม
  endsAt: number | null;    // epoch ms; null = ไม่จำกัดสิ้นสุด
  source: string;           // "lazada" | "manual"
};
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/promotions.test.ts`
Expected: FAIL — cannot resolve `@/lib/promotions` (module not found).

- [ ] **Step 4: Implement the pure filters**

Create `lib/promotions.ts`:

```ts
import type { Promotion } from "./types";

/** โปรนี้ใช้ได้ ณ เวลา now ไหม (เช็คช่วงวันที่; null = ไม่จำกัด) */
export function isPromotionValidNow(p: Promotion, now: number): boolean {
  if (p.startsAt != null && now < p.startsAt) return false;
  if (p.endsAt != null && now > p.endsAt) return false;
  return true;
}

/** กรองเหลือเฉพาะโปรที่ใช้ได้ตอนนี้ (ที่จะป้อนให้ AI) */
export function validNowPromotions(promos: Promotion[], now: number): Promotion[] {
  return promos.filter((p) => isPromotionValidNow(p, now));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/promotions.test.ts`
Expected: PASS — `6 passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/promotions.ts test/promotions.test.ts
git commit -m "feat: Promotion type + validity filters (pure, tested)"
```

---

## Task 3: Lazada promotion fetch (mock-first) + parser

**Files:**
- Create: `lib/lazadaPromotions.ts`, `test/lazadaPromotions.test.ts`

**Interfaces:**
- Consumes: `isLazadaConfigured` from `lib/marketplace.ts`; `Promotion` from `lib/types.ts`.
- Produces: `parseLazadaPromotions(raw)`, `fetchPromotions(accessToken)`.

- [ ] **Step 1: Write the failing test**

Create `test/lazadaPromotions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLazadaPromotions, fetchPromotions } from "@/lib/lazadaPromotions";

describe("parseLazadaPromotions", () => {
  it("maps Lazada fields with defaults", () => {
    const raw = {
      data: {
        promotions: [
          {
            promotion_id: 99,
            title: "ลด 50 บาท",
            promotion_type: "fixed",
            min_order_value: "300",
            voucher_code: "SAVE50",
            start_time: "1700000000000",
            end_time: "1700000900000",
            applicable_products: "หูฟัง",
          },
        ],
      },
    };
    const out = parseLazadaPromotions(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "ลด 50 บาท",
      type: "fixed",
      code: "SAVE50",
      minSpend: 300,
      productScope: "หูฟัง",
      startsAt: 1700000000000,
      endsAt: 1700000900000,
      source: "lazada",
    });
  });

  it("unknown/empty shape → []", () => {
    expect(parseLazadaPromotions({})).toEqual([]);
  });
});

describe("fetchPromotions (mock)", () => {
  it("mock token → returns non-empty mock promotions, all titled", async () => {
    const out = await fetchPromotions("mock-lazada");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.title.length > 0 && p.source === "lazada")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lazadaPromotions.test.ts`
Expected: FAIL — cannot resolve `@/lib/lazadaPromotions`.

- [ ] **Step 3: Implement the fetch + parser (mock-first)**

Create `lib/lazadaPromotions.ts`:

```ts
import "server-only";
import { createHmac } from "node:crypto";
import { isLazadaConfigured } from "./marketplace";
import type { Promotion } from "./types";

const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";
// NOTE: endpoint + สิทธิ์ Promotion ของ Lazada ยังต้องยืนยันใน console ก่อนใช้จริง
// ถ้ายังไม่ได้สิทธิ์ การเรียกจริงจะ parse ไม่เจอ → คืน [] (mock/manual ครอบช่องว่างไว้)
const PROMOTIONS_PATH = "/promotion/get";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** แปลง payload ดิบของ Lazada → Promotion[] (ป้องกันรูปแบบไม่ตรงด้วยค่า default) */
export function parseLazadaPromotions(raw: Record<string, unknown>): Promotion[] {
  const data = (raw.data ?? {}) as Record<string, unknown>;
  const list = (data.promotions as unknown[]) ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const x = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(x.promotion_id ?? ""),
      title: String(x.title ?? "").trim(),
      type: String(x.promotion_type ?? "").trim(),
      conditionsText: String(x.description ?? x.title ?? "").trim(),
      minSpend: num(x.min_order_value),
      productScope: String(x.applicable_products ?? "").trim(),
      code: String(x.voucher_code ?? "").trim(),
      startsAt: num(x.start_time),
      endsAt: num(x.end_time),
      source: "lazada",
    };
  });
}

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const base = path + sorted.map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

/** mock promotions — ครอบเคสที่ต้องเทสต์: ทุกชิ้น / มีโค้ด+ขั้นต่ำ / เจาะสินค้า / กำลังจะหมด */
function mockPromotions(): Promotion[] {
  const now = Date.now();
  const day = 1000 * 60 * 60 * 24;
  return [
    {
      id: "MOCK-FREESHIP", title: "ส่งฟรีเมื่อช้อปครบ 300",
      type: "fixed", conditionsText: "ยอดสั่งซื้อรวมตั้งแต่ 300 บาทขึ้นไป ส่งฟรี",
      minSpend: 300, productScope: "", code: "", startsAt: now - day, endsAt: now + day * 14, source: "lazada",
    },
    {
      id: "MOCK-SAVE10", title: "โค้ด SAVE10 ลด 10%",
      type: "code", conditionsText: "กรอกโค้ด SAVE10 ลด 10% ขั้นต่ำ 200 บาท",
      minSpend: 200, productScope: "", code: "SAVE10", startsAt: now - day, endsAt: now + day * 7, source: "lazada",
    },
    {
      id: "MOCK-BUNDLE", title: "หูฟัง + เคส ลดเพิ่ม 50",
      type: "bundle", conditionsText: "ซื้อหูฟังคู่กับเคส ลดเพิ่ม 50 บาท",
      minSpend: null, productScope: "หูฟัง,เคส", code: "", startsAt: now - day, endsAt: now + day * 3, source: "lazada",
    },
  ];
}

/** ดึงโปรจาก Lazada — mock เมื่อยังไม่ตั้งคีย์จริง/โทเค็น mock; ของจริงเมื่อพร้อม */
export async function fetchPromotions(accessToken: string): Promise<Promotion[]> {
  if (!isLazadaConfigured() || accessToken.startsWith("mock")) {
    return mockPromotions();
  }
  const appKey = process.env.LAZADA_APP_KEY as string;
  const appSecret = process.env.LAZADA_APP_SECRET as string;
  const params: Record<string, string> = {
    app_key: appKey,
    access_token: accessToken,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  params.sign = sign(PROMOTIONS_PATH, params, appSecret);
  try {
    const res = await fetch(`${API_BASE}${PROMOTIONS_PATH}?${new URLSearchParams(params)}`, {
      method: "GET",
    });
    const json = (await res.json()) as Record<string, unknown>;
    return parseLazadaPromotions(json);
  } catch {
    return []; // ของจริงล่ม/ไม่มีสิทธิ์ → ไม่มีโปร (ไม่ทำให้ทั้งระบบพัง)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lazadaPromotions.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/lazadaPromotions.ts test/lazadaPromotions.test.ts
git commit -m "feat: fetchPromotions (Lazada, mock-first) + parser"
```

---

## Task 4: promotions table + repo + sync route

**Files:**
- Modify: `lib/db.ts` (add table + index)
- Create: `lib/promotionsRepo.ts`, `app/api/promotions/sync/route.ts`, `scripts/test-promotions.mjs`

**Interfaces:**
- Consumes: `query`, `withTx` from `lib/db.ts`; `newId` from `lib/auth.ts`; `Promotion` from `lib/types.ts`; `fetchPromotions` from `lib/lazadaPromotions.ts`; `getValidAccessToken` from `lib/connectionRepo.ts`; `getCurrentAdmin` from `lib/auth.ts`.
- Produces: `listPromotions(shopId)`, `replacePromotions(shopId, promos)`; `POST /api/promotions/sync`.

- [ ] **Step 1: Add the `promotions` table to the schema**

In `lib/db.ts`, inside the `ensureSchema()` template, add the table immediately before the line `CREATE INDEX IF NOT EXISTS idx_rules_shop ON rules(shop_id);`:

```sql
    -- โปรโมชั่นที่ sync มาจาก Lazada (ระดับร้าน) ให้ AI แนะนำลูกค้า
    CREATE TABLE IF NOT EXISTS promotions (
      id              TEXT PRIMARY KEY,
      shop_id         TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      title           TEXT NOT NULL DEFAULT '',
      type            TEXT NOT NULL DEFAULT '',
      conditions_text TEXT NOT NULL DEFAULT '',
      min_spend       INTEGER,
      product_scope   TEXT NOT NULL DEFAULT '',
      code            TEXT NOT NULL DEFAULT '',
      starts_at       BIGINT,
      ends_at         BIGINT,
      source          TEXT NOT NULL DEFAULT 'lazada',
      synced_at       BIGINT NOT NULL
    );

```

And add this index next to the other `CREATE INDEX` lines, after `idx_shopee_channels_account`:

```sql
    CREATE INDEX IF NOT EXISTS idx_promotions_shop ON promotions(shop_id);
```

- [ ] **Step 2: Implement the repo**

Create `lib/promotionsRepo.ts`:

```ts
import "server-only";
import { query, withTx } from "./db";
import { newId } from "./auth";
import type { Promotion } from "./types";

type Row = {
  id: string;
  title: string;
  type: string;
  conditions_text: string;
  min_spend: number | null;
  product_scope: string;
  code: string;
  starts_at: string | null;
  ends_at: string | null;
  source: string;
};

function toPromotion(r: Row): Promotion {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    conditionsText: r.conditions_text,
    minSpend: r.min_spend != null ? Number(r.min_spend) : null,
    productScope: r.product_scope,
    code: r.code,
    startsAt: r.starts_at != null ? Number(r.starts_at) : null,
    endsAt: r.ends_at != null ? Number(r.ends_at) : null,
    source: r.source,
  };
}

export async function listPromotions(shopId: string): Promise<Promotion[]> {
  const rows = await query<Row>(
    `SELECT id, title, type, conditions_text, min_spend, product_scope, code,
            starts_at, ends_at, source
       FROM promotions WHERE shop_id = $1 ORDER BY synced_at DESC`,
    [shopId],
  );
  return rows.map(toPromotion);
}

/** แทนที่โปรทั้งหมดของร้านด้วยชุดล่าสุด (sync) — ทำใน transaction */
export async function replacePromotions(shopId: string, promos: Promotion[]): Promise<void> {
  const now = Date.now();
  await withTx(async (client) => {
    await client.query("DELETE FROM promotions WHERE shop_id = $1", [shopId]);
    for (const p of promos) {
      await client.query(
        `INSERT INTO promotions
           (id, shop_id, title, type, conditions_text, min_spend, product_scope, code, starts_at, ends_at, source, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [newId(), shopId, p.title, p.type, p.conditionsText, p.minSpend, p.productScope, p.code, p.startsAt, p.endsAt, p.source, now],
      );
    }
  });
}
```

- [ ] **Step 3: Implement the sync route**

Create `app/api/promotions/sync/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { fetchPromotions } from "@/lib/lazadaPromotions";
import { replacePromotions, listPromotions } from "@/lib/promotionsRepo";

export const runtime = "nodejs";

// ดึงโปรโมชั่นล่าสุดจาก Lazada → เก็บลง DB → คืนรายการที่เก็บแล้ว
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  // ยังไม่เชื่อม Lazada → ใช้ token mock เพื่อเดโม (fetchPromotions จะคืน mock)
  const token = (await getValidAccessToken(admin.shopId, "lazada")) ?? "mock-lazada";
  const promos = await fetchPromotions(token);
  await replacePromotions(admin.shopId, promos);
  return NextResponse.json({
    synced: promos.length,
    promotions: await listPromotions(admin.shopId),
  });
}
```

- [ ] **Step 4: Write the integration smoke test (throwaway shop)**

Create `scripts/test-promotions.mjs`:

```js
// สโมกเทสต์ตาราง promotions: สร้างร้านชั่วคราว mkt_promotest → insert/select → ลบทิ้ง (cascade)
// แตะเฉพาะร้าน mkt_promotest เท่านั้น
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

const p = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const shopId = randomUUID();
const now = Date.now();
try {
  await p.query("INSERT INTO shops (id, name, voice, created_at) VALUES ($1,'mkt_promotest','',$2)", [shopId, now]);

  await p.query(
    `INSERT INTO promotions (id, shop_id, title, type, conditions_text, min_spend, product_scope, code, starts_at, ends_at, source, synced_at)
     VALUES ($1,$2,'ส่งฟรี 300','fixed','ยอดถึง 300',300,'','',$3,$4,'lazada',$5)`,
    [randomUUID(), shopId, now - 1000, now + 1000, now],
  );

  const rows = await p.query("SELECT title, min_spend FROM promotions WHERE shop_id = $1", [shopId]);
  if (rows.rowCount === 1 && rows.rows[0].title === "ส่งฟรี 300" && Number(rows.rows[0].min_spend) === 300) {
    console.log("PASS: promotions round-trip ok");
  } else {
    console.log("FAIL: unexpected rows", rows.rows);
    process.exitCode = 1;
  }
} finally {
  await p.query("DELETE FROM shops WHERE id = $1", [shopId]); // cascade ลบ promotions ด้วย
  await p.end();
}
```

- [ ] **Step 5: Run the smoke test**

Run: `node scripts/test-promotions.mjs`
Expected: prints `PASS: promotions round-trip ok` (auto-creates the table on first DB touch via `ensureSchema`; if running the script alone doesn't trigger schema creation, start the dev server once — `npm run dev` — to create the table, then re-run).

- [ ] **Step 6: Type-check the new route + repo via build**

Run: `npx next build`
Expected: `Compiled successfully` (no TypeScript errors). A new route `ƒ /api/promotions/sync` appears in the route list.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts lib/promotionsRepo.ts app/api/promotions/sync/route.ts scripts/test-promotions.mjs
git commit -m "feat: promotions table + repo + /api/promotions/sync"
```

---

## Task 5: Inject promotions into the AI prompt

**Files:**
- Modify: `lib/types.ts` (`GenerateRequest`), `lib/prompt.ts`, `lib/autoReply.ts`, `app/api/line/draft/route.ts`, `app/api/line/choices/route.ts`
- Create: `test/prompt.test.ts`

**Interfaces:**
- Consumes: `Promotion` (types), `validNowPromotions` (promotions), `listPromotions` (promotionsRepo).
- Produces: `buildUserContent` renders a `[โปรโมชั่นที่ใช้ได้ตอนนี้]` block from `req.promotions`.

- [ ] **Step 1: Add `promotions` to `GenerateRequest`**

In `lib/types.ts`, change the `GenerateRequest` type to add the field:

```ts
export type GenerateRequest = {
  shopName: string;
  shopVoice: string;
  shopMemory: string; // ข้อมูล/นโยบายร้านที่ร้านอยากให้ AI จำ (ดู Shop.memory)
  products: Product[];
  promotions?: Promotion[]; // โปรโมชั่นที่ใช้ได้ตอนนี้ (กรองแล้ว) ให้ AI แนะนำ
  customerMsg: string; // ข้อความ + บริบทจากลูกค้า รวมในช่องเดียว
  imageUrls?: string[]; // ลิงก์รูปจากลูกค้า (ส่งเข้า Claude ให้ดูภาพ) — มีเฉพาะตอนแชตมีรูป
};
```

- [ ] **Step 2: Write the failing test**

Create `test/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUserContent } from "@/lib/prompt";
import type { Promotion } from "@/lib/types";

const promo: Promotion = {
  id: "p1", title: "ซื้อ 2 ลด 50", type: "bundle", conditionsText: "ซื้อ 2 ชิ้นขึ้นไป",
  minSpend: null, productScope: "หูฟัง", code: "", startsAt: null, endsAt: null, source: "lazada",
};

describe("buildUserContent promotions block", () => {
  it("renders promotions when present", () => {
    const out = buildUserContent({
      shopName: "ร้าน", shopVoice: "", shopMemory: "", products: [],
      customerMsg: "สนใจหูฟัง", promotions: [promo],
    });
    expect(out).toContain("โปรโมชั่นที่ใช้ได้ตอนนี้");
    expect(out).toContain("ซื้อ 2 ลด 50");
    expect(out).toContain("ใช้กับ: หูฟัง");
  });

  it("shows an explicit empty notice when no promotions", () => {
    const out = buildUserContent({
      shopName: "ร้าน", shopVoice: "", shopMemory: "", products: [], customerMsg: "hi",
    });
    expect(out).toContain("ไม่มีโปรโมชั่น");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/prompt.test.ts`
Expected: FAIL — output does not contain `"โปรโมชั่นที่ใช้ได้ตอนนี้"`.

- [ ] **Step 4: Render the promotions block in `buildUserContent`**

In `lib/prompt.ts`, inside `buildUserContent`, after the `const productsBlock = ...` line and before the `return` statement, add:

```ts
  const promoLines = (req.promotions ?? [])
    .filter((p) => p.title.trim())
    .map((p) => {
      const scope = p.productScope.trim() || "ทุกชิ้น";
      const min = p.minSpend != null ? `${p.minSpend}` : "-";
      const code = p.code.trim() || "-";
      const cond = p.conditionsText.trim() || "-";
      return `- ${p.title.trim()} | ใช้กับ: ${scope} | ขั้นต่ำ ${min} บาท | โค้ด ${code} | เงื่อนไข: ${cond}`;
    })
    .join("\n");
  const promoBlock = promoLines || "- (ตอนนี้ไม่มีโปรโมชั่น)";
```

Then add the block to the returned template, immediately after the `[คลังสินค้า ...]` block and before `[ข้อความ/บริบทจากลูกค้า]`:

```ts
[โปรโมชั่นที่ใช้ได้ตอนนี้ (แนะนำได้เฉพาะที่ตรงเงื่อนไข + ใช้กับสินค้าที่ลูกค้าสนใจ ห้ามแต่งเอง)]
${promoBlock}

```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/prompt.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 6: Add the promotion rule to both system prompts**

In `lib/prompt.ts`, in `REPLY_SYSTEM_PROMPT`, add a new principle right after principle 7 (the stock rule), before the line `สำคัญมาก: ฟิลด์ message ห้ามว่าง...`:

```
8. โปรโมชั่น: แนะนำได้เฉพาะโปรที่อยู่ใน [โปรโมชั่นที่ใช้ได้ตอนนี้] เท่านั้น ห้ามแต่งโปร/ส่วนลด/โค้ดเอง; เสนอต่อเมื่อ (ก) โปรนั้นใช้กับสินค้าที่ลูกค้ากำลังสนใจได้ และ (ข) ลูกค้าเข้าเงื่อนไข เช่น ยอดขั้นต่ำถึง; บอกเงื่อนไขให้ครบ ไม่ตัดทอนจนเข้าใจผิด ถ้าไม่มีโปรที่เข้าเงื่อนไขก็ไม่ต้องเสนอ
```

In `CHOICES_SYSTEM_PROMPT`, add a bullet after the stock bullet:

```
- โปรโมชั่น: เสนอได้เฉพาะโปรใน [โปรโมชั่นที่ใช้ได้ตอนนี้] ที่ใช้กับสินค้าที่ลูกค้าสนใจได้ + ลูกค้าเข้าเงื่อนไข ห้ามแต่งโปรเอง
```

- [ ] **Step 7: Load promotions in `autoReply.ts`**

In `lib/autoReply.ts`, add imports near the other `./` imports:

```ts
import { listPromotions } from "./promotionsRepo";
import { validNowPromotions } from "./promotions";
```

In `processAutoReply`, after `const ctx = buildConversationContext(...)` and before `const result = await generateReply({`, add:

```ts
    const promotions = validNowPromotions(await listPromotions(shopId), Date.now());
```

Then add `promotions,` to the object passed to `generateReply` (after `products: shopData.products,`).

- [ ] **Step 8: Load promotions in the draft route**

In `app/api/line/draft/route.ts`, add imports:

```ts
import { listPromotions } from "@/lib/promotionsRepo";
import { validNowPromotions } from "@/lib/promotions";
```

After `const shopData = await getShopData(admin.shopId);`, add:

```ts
  const promotions = validNowPromotions(await listPromotions(admin.shopId), Date.now());
```

Then add `promotions,` to the `generateReply({ ... })` argument (after `products: shopData.products,`).

- [ ] **Step 9: Load promotions in the choices route**

In `app/api/line/choices/route.ts`, add the same two imports as Step 8. After `const shopData = await getShopData(admin.shopId);`, add:

```ts
  const promotions = validNowPromotions(await listPromotions(admin.shopId), Date.now());
```

Then add `promotions,` to the `generateChoices({ ... })` argument (after `products: shopData.products,`).

- [ ] **Step 10: Run all unit tests + build**

Run: `npx vitest run`
Expected: PASS — all tests green (sanity + promotions + lazadaPromotions + prompt).

Run: `npx next build`
Expected: `Compiled successfully` (no type errors across autoReply + both routes).

- [ ] **Step 11: Commit**

```bash
git add lib/types.ts lib/prompt.ts lib/autoReply.ts app/api/line/draft/route.ts app/api/line/choices/route.ts test/prompt.test.ts
git commit -m "feat: feed valid promotions into AI prompt + recommendation rules"
```

---

## Manual verification (after Task 5)

1. `npm run dev`, log into a test shop, `POST /api/promotions/sync` (e.g. from the browser console: `fetch('/api/promotions/sync',{method:'POST'}).then(r=>r.json()).then(console.log)`). Expect `{ synced: 3, promotions: [...] }` (mock data, since real Lazada promo access is unconfirmed).
2. In the inbox, have a test customer ask about หูฟัง and trigger a draft. The AI may weave in the "หูฟัง + เคส ลดเพิ่ม 50" promo when relevant — and must NOT invent any promo not in the synced list.

---

## Out of Scope (this plan)

- Manual promo entry UI (schema supports `source = 'manual'`; UI deferred).
- A "sync promotions" button in Settings UI (call the endpoint manually for now; UI button is a tiny follow-up).
- Order/shipping lookup (separate plan — the tool-calling subsystem).
- Upsell measurement metric (deferred per user; revisit after the Lazada phase — see memory `salesmate-upsell-differentiator`).
