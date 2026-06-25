# Upsell Sold (B3) + Lazada Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two dashboard numbers — **"ยอดขาย Lazada เดือนนี้"** (real, from GetOrders) and **"พ่วงขายได้จริง"** (match a sent upsell to that buyer's Lazada order items; works on mock/demo now, real once a buyer↔order link exists).

**Architecture:** Extend `lib/lazadaOrders.ts` with order-item prices + a `salesSince` revenue sum. A pure matcher links an `upsell_events.product` to a Lazada order item; an attribution job marks matched events `sold` with the item's price. A refresh endpoint runs attribution and returns sales + offered + sold; the dashboard tile shows all three.

**Tech Stack:** Next.js 16 + TypeScript, Postgres (Neon) via `pg`, Lazada Order API (mock-first), vitest.

## Global Constraints

- **Mock-first / read-only:** real Lazada calls only when configured + non-mock token; all GET. (existing pattern)
- **B3 attribution is buyer-scoped:** only for Lazada-channel conversations where the buyer id is known. On real Lazada, `getOrdersByBuyer` returns `[]` (no by-buyer filter) → real sold-attribution stays 0 until a buyer↔order link exists; the logic still runs in **mock/demo**. (decided with user 2026-06-25)
- **Honest labels:** "ยอดขาย Lazada (เดือนนี้)", "พ่วงขายได้จริง". Sales tile notes Lazada-only.
- **Best-effort:** attribution never throws into the dashboard; failures leave events un-sold.
- **No destructive tests on real data:** throwaway `mkt_` shops. Period = current month, UTC+7 (`monthStart`). Model unchanged.

---

## File Structure

**New:**
- `lib/upsellMatch.ts` — pure `matchUpsellProduct`.
- `lib/upsellAttribution.ts` — `attributeUpsells` job.
- `app/api/metrics/refresh/route.ts` — POST: run attribution, return all metrics.
- `test/upsellMatch.test.ts`, `test/lazadaSales.test.ts` — unit tests.

**Modified:**
- `lib/lazadaOrders.ts` — add `price` to `OrderItem`; add `salesSince`.
- `lib/upsellRepo.ts` — add `listUnsoldUpsells`, `markUpsellSold`, `soldSummary`.
- `lib/db.ts` — no change (B3 columns already exist from B1).
- `components/UpsellMetric.tsx` — POST refresh, show sales + offered + sold.
- `test/lazadaOrders.test.ts` — update item expectation to include `price`.

**Shared interfaces:**

```ts
// lib/lazadaOrders.ts
export type OrderItem = { name: string; quantity: number; price: number };
export function salesSince(accessToken: string, sinceMs: number): Promise<{ orderCount: number; totalRevenue: number }>;

// lib/upsellMatch.ts
export function matchUpsellProduct(product: string, items: { name: string; price: number }[]): { price: number } | null;

// lib/upsellRepo.ts
export type UnsoldUpsell = { id: string; conversationId: string; channel: string; product: string };
export function listUnsoldUpsells(shopId: string, sinceMs: number): Promise<UnsoldUpsell[]>;
export function markUpsellSold(id: string, soldValue: number, orderId: string): Promise<void>;
export function soldSummary(shopId: string, sinceMs: number): Promise<{ count: number; totalSoldValue: number }>;

// lib/upsellAttribution.ts
export function attributeUpsells(shopId: string, token: string): Promise<number>;
```

---

## Task 1: Order-item price + Lazada sales total

**Files:**
- Modify: `lib/lazadaOrders.ts`, `test/lazadaOrders.test.ts`
- Create: `test/lazadaSales.test.ts`

**Interfaces:**
- Produces: `OrderItem` with `price`; `salesSince(token, sinceMs)`.

- [ ] **Step 1: Update the existing order test for the new `price` field**

In `test/lazadaOrders.test.ts`, change the items assertion in the `parseOrder` test:

Old:
```ts
    expect(o?.items).toEqual([{ name: "หูฟัง", quantity: 2 }]);
```
New:
```ts
    expect(o?.items).toEqual([{ name: "หูฟัง", quantity: 2, price: 0 }]);
```

- [ ] **Step 2: Write the failing sales test**

Create `test/lazadaSales.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { salesSince } from "@/lib/lazadaOrders";

describe("salesSince (mock token)", () => {
  it("returns a positive demo revenue", async () => {
    const out = await salesSince("mock-lazada", 0);
    expect(out.orderCount).toBeGreaterThan(0);
    expect(out.totalRevenue).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/lazadaSales.test.ts test/lazadaOrders.test.ts`
Expected: FAIL — `salesSince` not exported; `parseOrder` items lack `price`.

- [ ] **Step 4: Add `price` to `OrderItem`, thread it through, add `salesSince`**

In `lib/lazadaOrders.ts`:

(a) Change the `OrderItem` type:
```ts
export type OrderItem = { name: string; quantity: number; price: number };
```

(b) In `parseOrder`, change the items mapping to include price:
```ts
  const items: OrderItem[] = Array.isArray(itemsRaw)
    ? itemsRaw.map((it) => {
        const x = (it ?? {}) as Record<string, unknown>;
        return {
          name: String(x.name ?? "").trim(),
          quantity: Number(x.quantity ?? 1) || 1,
          price: Number(x.paid_price ?? x.item_price ?? 0) || 0,
        };
      })
    : [];
```

(c) Replace `aggregateItems` to also sum price:
```ts
// Lazada คืน order item 1 แถวต่อ 1 ชิ้น → รวมตามชื่อ (นับจำนวน + รวมราคา)
function aggregateItems(arr: unknown[]): OrderItem[] {
  const map = new Map<string, { quantity: number; price: number }>();
  for (const it of arr) {
    const x = (it ?? {}) as Record<string, unknown>;
    const name = String(x.name ?? "").trim();
    if (!name) continue;
    const q = Number(x.quantity ?? 1) || 1;
    const pr = Number(x.paid_price ?? x.item_price ?? 0) || 0;
    const cur = map.get(name) ?? { quantity: 0, price: 0 };
    map.set(name, { quantity: cur.quantity + q, price: cur.price + pr });
  }
  return [...map].map(([name, v]) => ({ name, quantity: v.quantity, price: v.price }));
}
```

(d) In `mockOrder`, give the item a price:
```ts
    items: [{ name: "หูฟังบลูทูธ TWS", quantity: 1, price: 590 }],
```

(e) Add `salesSince` at the end of the file:
```ts
/** ยอดขายรวมจาก Lazada ตั้งแต่ sinceMs (mock = ตัวเลขเดโม; จริง = รวม price จาก GetOrders) */
export async function salesSince(
  accessToken: string,
  sinceMs: number,
): Promise<{ orderCount: number; totalRevenue: number }> {
  if (isMock(accessToken)) return { orderCount: 12, totalRevenue: 128400 };
  try {
    const data = await signedGet("/orders/get", accessToken, {
      created_after: new Date(sinceMs).toISOString(),
      limit: "100",
    });
    if (String(data.code ?? "0") !== "0") return { orderCount: 0, totalRevenue: 0 };
    const orders = ((data.data as Record<string, unknown>)?.orders as unknown[]) ?? [];
    let total = 0;
    for (const o of orders) {
      total += Number((o as Record<string, unknown>).price ?? 0) || 0;
    }
    return { orderCount: orders.length, totalRevenue: Math.round(total) };
  } catch {
    return { orderCount: 0, totalRevenue: 0 };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/lazadaSales.test.ts test/lazadaOrders.test.ts`
Expected: PASS (sales: 1 passed; orders: 7 passed).

- [ ] **Step 6: Commit**

```bash
git add lib/lazadaOrders.ts test/lazadaOrders.test.ts test/lazadaSales.test.ts
git commit -m "feat: order-item price + Lazada salesSince (mock-first)"
```

---

## Task 2: Attribution matcher (pure) + sold repo functions

**Files:**
- Create: `lib/upsellMatch.ts`, `test/upsellMatch.test.ts`
- Modify: `lib/upsellRepo.ts`

**Interfaces:**
- Consumes: `query`, `queryOne` (db).
- Produces: `matchUpsellProduct`; `UnsoldUpsell`, `listUnsoldUpsells`, `markUpsellSold`, `soldSummary`.

- [ ] **Step 1: Write the failing matcher test**

Create `test/upsellMatch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchUpsellProduct } from "@/lib/upsellMatch";

const items = [
  { name: "หูฟังบลูทูธ TWS", price: 590 },
  { name: "สายชาร์จ USB-C", price: 190 },
];

describe("matchUpsellProduct", () => {
  it("matches by substring (event product inside item name)", () => {
    expect(matchUpsellProduct("หูฟัง", items)).toEqual({ price: 590 });
  });
  it("matches the other direction (item name inside event product)", () => {
    expect(matchUpsellProduct("สายชาร์จ USB-C ยาว 2m", items)).toEqual({ price: 190 });
  });
  it("returns null when nothing matches", () => {
    expect(matchUpsellProduct("เคสมือถือ", items)).toBeNull();
  });
  it("returns null for an empty product", () => {
    expect(matchUpsellProduct("", items)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upsellMatch.test.ts`
Expected: FAIL — cannot resolve `@/lib/upsellMatch`.

- [ ] **Step 3: Implement the pure matcher**

Create `lib/upsellMatch.ts`:

```ts
/** จับคู่ "สินค้าที่ AI พ่วง" กับรายการสินค้าในออเดอร์ (ตรงแบบ contains สองทาง) — คืนราคาที่ขายได้ */
export function matchUpsellProduct(
  product: string,
  items: { name: string; price: number }[],
): { price: number } | null {
  const p = product.trim().toLowerCase();
  if (!p) return null;
  for (const it of items) {
    const n = it.name.trim().toLowerCase();
    if (n && (n.includes(p) || p.includes(n))) return { price: it.price };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upsellMatch.test.ts`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Add the sold repo functions**

In `lib/upsellRepo.ts`, append:

```ts
export type UnsoldUpsell = {
  id: string;
  conversationId: string;
  channel: string;
  product: string;
};

/** เหตุการณ์พ่วงที่ยังไม่ถูกแมตช์ว่าขายได้ (ภายในช่วง sinceMs) */
export async function listUnsoldUpsells(shopId: string, sinceMs: number): Promise<UnsoldUpsell[]> {
  const rows = await query<{ id: string; conversation_id: string; channel: string; product: string }>(
    `SELECT id, conversation_id, channel, product
       FROM upsell_events
      WHERE shop_id = $1 AND created_at >= $2 AND sold = false AND product <> ''`,
    [shopId, sinceMs],
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    channel: r.channel,
    product: r.product,
  }));
}

/** ทำเครื่องหมายว่าพ่วงนี้ขายได้จริง (จากการแมตช์ออเดอร์) */
export async function markUpsellSold(id: string, soldValue: number, orderId: string): Promise<void> {
  await query(
    "UPDATE upsell_events SET sold = true, sold_value = $1, matched_order_id = $2 WHERE id = $3",
    [Math.round(soldValue), orderId, id],
  );
}

/** สรุปจำนวน + มูลค่าพ่วงที่ขายได้จริง ตั้งแต่ sinceMs */
export async function soldSummary(
  shopId: string,
  sinceMs: number,
): Promise<{ count: number; totalSoldValue: number }> {
  const row = await queryOne<{ count: number; total: number | null }>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(sold_value),0)::int AS total
       FROM upsell_events WHERE shop_id = $1 AND created_at >= $2 AND sold = true`,
    [shopId, sinceMs],
  );
  return { count: Number(row?.count ?? 0), totalSoldValue: Number(row?.total ?? 0) };
}
```

- [ ] **Step 6: Type-check**

Run: `npx next build`
Expected: `Compiled successfully`.

- [ ] **Step 7: Commit**

```bash
git add lib/upsellMatch.ts test/upsellMatch.test.ts lib/upsellRepo.ts
git commit -m "feat: upsell↔order matcher (pure) + sold repo (list/mark/summary)"
```

---

## Task 3: Attribution job + refresh endpoint

**Files:**
- Create: `lib/upsellAttribution.ts`, `app/api/metrics/refresh/route.ts`

**Interfaces:**
- Consumes: `listUnsoldUpsells`, `markUpsellSold`, `soldSummary`, `upsellSummary`, `monthStart` (upsellRepo); `getOrdersByBuyer`, `salesSince` (lazadaOrders); `matchUpsellProduct` (upsellMatch); `getSendTarget` (inboxRepo); `getValidAccessToken` (connectionRepo); `getCurrentAdmin` (auth).
- Produces: `attributeUpsells(shopId, token)`; `POST /api/metrics/refresh`.

- [ ] **Step 1: Implement the attribution job**

Create `lib/upsellAttribution.ts`:

```ts
import "server-only";
import { listUnsoldUpsells, markUpsellSold } from "./upsellRepo";
import { getSendTarget } from "./inboxRepo";
import { getOrdersByBuyer } from "./lazadaOrders";
import { matchUpsellProduct } from "./upsellMatch";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // กรอบแมตช์ 7 วัน

/**
 * แมตช์พ่วงที่ส่งไปกับออเดอร์จริงของลูกค้ารายนั้น (เฉพาะแชต Lazada ที่รู้ buyer)
 * คืนจำนวนเหตุการณ์ที่เพิ่งแมตช์ได้ใหม่ — best-effort, ข้ามตัวที่พลาด
 */
export async function attributeUpsells(shopId: string, token: string): Promise<number> {
  const since = Date.now() - WINDOW_MS;
  const events = await listUnsoldUpsells(shopId, since);
  let matched = 0;
  for (const e of events) {
    if (e.channel !== "lazada") continue; // จับคู่ได้เฉพาะที่รู้ buyer
    try {
      const target = await getSendTarget(shopId, e.conversationId);
      const buyerId = target?.lineUserId;
      if (!buyerId) continue;
      const orders = await getOrdersByBuyer(token, buyerId);
      for (const o of orders) {
        const hit = matchUpsellProduct(e.product, o.items);
        if (hit) {
          await markUpsellSold(e.id, hit.price, o.orderId);
          matched++;
          break;
        }
      }
    } catch {
      // ข้ามเหตุการณ์ที่พลาด ไม่ให้ทั้ง job ล้ม
    }
  }
  return matched;
}
```

- [ ] **Step 2: Implement the refresh endpoint**

Create `app/api/metrics/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { attributeUpsells } from "@/lib/upsellAttribution";
import { salesSince } from "@/lib/lazadaOrders";
import { upsellSummary, soldSummary, monthStart } from "@/lib/upsellRepo";

export const runtime = "nodejs";

// รัน attribution (best-effort) แล้วคืนตัวเลขทั้งหมดของเดือนนี้
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const token = (await getValidAccessToken(admin.shopId, "lazada")) ?? "mock-lazada";
  await attributeUpsells(admin.shopId, token).catch(() => {});

  const since = monthStart(Date.now());
  const [sales, offered, sold] = await Promise.all([
    salesSince(token, since),
    upsellSummary(admin.shopId, since),
    soldSummary(admin.shopId, since),
  ]);
  return NextResponse.json({ sales, offered, sold });
}
```

- [ ] **Step 3: Type-check + build**

Run: `npx next build`
Expected: `Compiled successfully` — route `ƒ /api/metrics/refresh` appears.

- [ ] **Step 4: Commit**

```bash
git add lib/upsellAttribution.ts app/api/metrics/refresh/route.ts
git commit -m "feat: upsell attribution job + /api/metrics/refresh"
```

---

## Task 4: Dashboard — sales + offered + sold tiles

**Files:**
- Modify: `components/UpsellMetric.tsx`

**Interfaces:**
- Consumes: `POST /api/metrics/refresh` → `{ sales, offered, sold }`.

- [ ] **Step 1: Replace the tile to POST refresh and show all three numbers**

Replace the entire contents of `components/UpsellMetric.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";

type Metrics = {
  sales: { orderCount: number; totalRevenue: number };
  offered: { count: number; totalEstValue: number };
  sold: { count: number; totalSoldValue: number };
};

export default function UpsellMetric() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics/refresh", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && d.offered) setM(d as Metrics);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ซ่อนทั้งแถบถ้ายังไม่มีอะไรให้โชว์เลย
  if (!m || (m.offered.count === 0 && m.sales.totalRevenue === 0)) return null;

  const baht = (n: number) => `฿${n.toLocaleString()}`;

  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Tile label="ยอดขาย Lazada (เดือนนี้)" value={baht(m.sales.totalRevenue)} hint={`${m.sales.orderCount} ออเดอร์`} />
      <Tile label="AI เสนอพ่วง (ส่งแล้ว)" value={baht(m.offered.totalEstValue)} hint={`${m.offered.count} ครั้ง`} />
      <Tile label="พ่วงขายได้จริง" value={baht(m.sold.totalSoldValue)} hint={`${m.sold.count} ครั้ง`} highlight />
    </div>
  );
}

function Tile({
  label, value, hint, highlight,
}: {
  label: string; value: string; hint: string; highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        highlight
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
          : "border-zinc-300/60 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-200"
      }`}
    >
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs opacity-60">{hint}</div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + build**

Run: `npx next build`
Expected: `Compiled successfully`.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log into a test shop. Run a `full`-mode AI conversation where the AI upsells a product whose name matches the mock order item ("หูฟัง…"). Load the dashboard inbox → the refresh runs attribution against the mock buyer order → the three tiles show: ยอดขาย Lazada (mock ฿128,400), AI เสนอพ่วง, and พ่วงขายได้จริง (the matched upsell's price). On real Lazada the sold tile stays ฿0 until a buyer↔order link exists (expected).

- [ ] **Step 4: Commit**

```bash
git add components/UpsellMetric.tsx
git commit -m "feat: dashboard tiles — Lazada sales + offered + sold upsell"
```

---

## Out of Scope (this plan)
- Real buyer↔order linking for Lazada (the blocker for real sold-attribution). Future: capture the buyer's order id during IM, or name/address matching.
- Shopee/TikTok sales.
- Manual-send upsell capture (still deferred from B1).
- A scheduled attribution cron (attribution runs on dashboard refresh for now).
```
