# Lazada AI Data Lookup (Phase 1) — Design

**Date:** 2026-06-25
**Status:** Approved (pending user spec review)
**Goal:** Let the AI answer customer questions about **orders, shipping/tracking, promotions, and product details** using real Lazada data — so customers get accurate answers and the AI can upsell with real, in-stock, on-promo offers.

This is **Phase 1**: Lazada only. Shopee/TikTok orders, order write-actions (cancel/edit), and claim/refund automation are out of scope (future phases).

---

## 1. Background & Constraints

The current AI reply pipeline is **static-context, single-shot**: `buildUserContent()` ([lib/prompt.ts](../../../lib/prompt.ts)) assembles shop name, voice, memory, and the product catalog (with stock) into one prompt, and the model returns one JSON answer. There is **no live data fetching during a conversation** and **no tool-calling**.

**Why Lazada first:** Lazada is the only marketplace where this seller has **real, working API access** — catalog pull and IM/chat both confirmed Active (the In-house IM Chat app was approved 2026-06-24; catalog APIs were already Active). Shopee (Mall/Managed gate) and TikTok (Partner/company gate) remain blocked for this account.

**Open access risk (must verify before/at implementation):** Lazada catalog + IM are confirmed Active, but **Order/Trade, Logistics, and Marketing/Promotion API permission groups are NOT yet confirmed** for the seller in-house app. If a group isn't granted, that capability runs **mock-only** until permission is requested/approved. The promotion source has a **manual-entry fallback** if the Promotion API is unavailable.

**Global constraints (carry into every task):**
- **Mock-first:** every new Lazada call has a mock fallback (mirrors `marketplace.ts` / `isLazadaConfigured()`), so demo + tests work with no real credentials. Real API is used automatically when credentials + access exist.
- **Read-only:** all new Lazada calls are GET (orders, items, trace, promotions). No write actions. No destructive tests; integration tests use throwaway `mkt_`-prefixed shops.
- **Thai-language, no emoji** answers (matches existing prompt rules).
- Model: `claude-sonnet-4-6` (existing).

---

## 2. Architecture — Two Data Planes (Approach C)

| Plane | Data | How it reaches the AI |
|---|---|---|
| **Shop-level (pre-fetched)** | catalog + stock (exists), **promotions (new)**, richer product detail | synced into DB on a schedule/refresh, injected into the prompt context like the catalog is today |
| **Per-customer (live, on-demand)** | order status, order items, shipment tracking | AI **tool-calling** — the model calls a lookup tool only when the customer asks |

Rationale: promotions are shop-wide, cheap to pre-fetch and keep fresh. Orders are per-customer and dynamic — pre-fetching them is wasteful and goes stale, so they are fetched live via tools only when needed. Tool-calling is added **only** to the order/shipping path; promotions/product-detail stay in the existing static-context mechanism. This contains the refactor.

---

## 3. Components

### 3.1 `lib/lazadaOrders.ts` (new)
Read-only Lazada order/logistics access, mock-first (same signing/`signedCall` pattern as `marketplace.ts`).
- `getOrdersByBuyer(token, buyerId)` → recent orders for a marketplace buyer (used by Lazada chat where buyer is known).
- `getOrder(token, orderId)` → one order's status + items.
- `traceShipment(token, orderId)` → latest logistics status / "where is the parcel."
- Returns typed shapes (e.g. `OrderSummary { orderId, status, createdAt, items[] }`, `ShipmentTrace { orderId, status, statusText, lastUpdate, trackingNumber, carrier }`). Mock data covers the common states (paid / packing / shipped / in-transit / delivered / not-found).

### 3.2 `lib/lazadaPromotions.ts` (new)
Read-only promotion/voucher pull, mock-first.
- `fetchPromotions(token)` → active vouchers/campaigns with **conditions**: title, type (e.g. % off / fixed / code), `minSpend`, product scope (which products it applies to), `code` (if any), `startsAt`, `endsAt`.
- Mock data includes valid, expired, and product-scoped promos so the validity/applicability rules can be tested.
- **Fallback:** if the Promotion API is not granted, the seller can enter promos manually (a `promotions` row with `source = 'manual'`); the AI treats both sources identically.

### 3.3 Promotion storage + sync
- New table `promotions(id, shop_id, title, type, conditions_text, min_spend, product_scope, code, starts_at, ends_at, source, synced_at)` (auto-migrated in `ensureSchema()`, `ON DELETE CASCADE` from shops).
- Sync entry point: a sibling endpoint `/api/promotions/sync` (kept separate from catalog sync so promotions can refresh on their own cadence) that calls `fetchPromotions` and upserts rows.
- The prompt builder injects **only currently-valid** promotions into a new `[โปรโมชั่นที่ใช้ได้ตอนนี้]` context block, with their conditions.

### 3.4 Reply pipeline → tool-calling (order/shipping path only)
- Add an Anthropic **tool-use loop** to the reply path (in `lib/claude.ts` / `lib/autoReply.ts`) exposing tools:
  - `lookup_order({ orderId })` → `getOrder`
  - `track_shipment({ orderId })` → `traceShipment`
  - `lookup_orders_by_buyer({ buyerId })` → `getOrdersByBuyer` (only offered when the conversation has a known marketplace `buyerId`)
- The model calls a tool → we run it → return the result → the model produces its **final answer in the existing JSON shape** (`{ message, needs_human, should_upsell, est_added_value, reason_for_admin }`). The JSON contract to the rest of the app is unchanged.
- Conversations with **no** order intent never invoke a tool — same cost/latency as today. Tools fire only when the customer asks about an order.

### 3.5 Identity handling
- **Lazada chat:** conversation carries the marketplace `buyerId` → AI may call `lookup_orders_by_buyer` automatically.
- **LINE / Facebook:** no `buyerId`. The AI must **ask for the order number** first (e.g. *"ขอเลขออเดอร์หน่อยค่ะ"*), then call `lookup_order` / `track_shipment` with it.

---

## 4. Behaviour Rules (prompt)

### 4.1 Safety (who answers)
- **AI answers directly:** factual API results only — order status, tracking status, "parcel is at X."
- **Escalate `needs_human = true` (route to seller), even in auto mode:** claims, cancellations, refunds, price negotiation, complaints, anything involving money/edits.
- **On API error / order-not-found:** the AI must **not guess** — reply "ขอเช็คให้สักครู่นะคะ" and set `needs_human = true`.

### 4.2 Promotion recommendation ("appropriate and OK")
The AI may recommend a promotion **only when all hold**:
- It **exists** in the synced promotion list (never invented).
- It is **currently valid** (now within `startsAt`..`endsAt`).
- It **applies to the product(s)** in the conversation, and the customer meets the conditions (e.g. `minSpend` reached).
- Conditions are stated accurately and completely (no misleading truncation).

This reinforces the existing upsell rule (one item at a time, framed as genuinely helpful, no pressure).

---

## 5. Data Flow Example (LINE)

1. Customer: *"ของส่งถึงไหนแล้วคะ"*
2. AI has no `buyerId` and no order number → replies asking for the order number (no tool call).
3. Customer: *"123456789"*
4. AI calls `track_shipment({ orderId: "123456789" })`.
5. Tool returns `{ status: "in-transit", statusText: "ถึงศูนย์คัดแยกบางนา", ... }`.
6. AI replies with the status (factual → may auto-send per app mode). If the lookup errored or returned not-found → `needs_human = true`.

---

## 6. Error Handling
- Tool/API failure or timeout → AI does not fabricate; replies "ขอเช็คให้สักครู่" + `needs_human = true`.
- Order not found → AI asks the customer to confirm the number, or escalates to the seller.
- Promotion sync failure → keep last successfully synced promos (cached in DB); if none, the AI simply does not mention promotions.

---

## 7. Testing
- **Unit (mock data):** order/trace/promotion response parsing; tool dispatch; identity routing (buyer-known vs ask-for-number); safety gating (claim/refund → `needs_human`); promotion validity + applicability filtering (expired excluded, product-scope respected, `minSpend` enforced).
- **Integration:** throwaway `mkt_` shop, mock credentials, end-to-end "ของส่งถึงไหน" and "มีโปรไหม" flows.
- No write operations; nothing tested against real shop data.

---

## 8. Out of Scope (future phases)
- Shopee / TikTok orders + tracking.
- Order **write** actions (cancel/edit/refund).
- Claim/refund automation.
- **Upsell measurement metric** — persist `est_added_value` per conversation + show a Dashboard "AI upsold +฿X" total. Deferred by user; revisit immediately after Phase 1 ships (see memory `salesmate-upsell-differentiator`).
