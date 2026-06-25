# Upsell & Sales Measurement — Design

**Date:** 2026-06-25
**Status:** Approved (pending user spec review)
**Goal:** Show the seller a dashboard number for **how much the AI upsold** (the SalesMate differentiator) — starting with what the AI *offered and actually sent* (B1), then upgrading to what customers *actually bought* (B3), plus total Lazada sales.

This is the measurement feature behind the positioning wedge ("AI ที่เพิ่มยอดขายได้จริง วัดเป็นตัวเลข"). See memory `salesmate-upsell-differentiator`.

---

## 1. Background

The reply prompt already asks the model for `should_upsell` and `est_added_value` (baht) per reply ([lib/prompt.ts](../../../lib/prompt.ts)), but the chat path **discards them** — `generateReply` returns only `{ message, needsHuman, reason }`. Nothing is stored. So measurement needs (a) to stop discarding these, (b) to know *which product* was upsold (for later order-matching), and (c) to record an event only when the upsell is actually sent to the customer.

The system does not process payments — money happens on the marketplace. So "sold" must be *attributed* from Lazada order data (which we can now read via the Order API), not observed directly.

---

## 2. Scope & Phasing

Two metrics, split into two plans (build A first):

- **Metric: Upsell offered (B1) — Plan A.** Count + sum of `est_added_value` for AI upsell messages **actually sent** to customers. Chat-side only; no order data.
- **Metric: Upsell sold (B3) + Lazada sales — Plan B.** Total Lazada order revenue, and upsell events matched to real orders ("พ่วงขายได้จริง"). Depends on order data.

**Rigor framing (honest labels):** B1 is labeled "เสนอพ่วง (ส่งแล้ว)" — offered, not sold. B3 is "พ่วงขายได้จริง" — confirmed against orders.

---

## 3. Data Model

New table `upsell_events` (auto-migrated in `ensureSchema()`, `ON DELETE CASCADE` from shops):

```sql
CREATE TABLE IF NOT EXISTS upsell_events (
  id               TEXT PRIMARY KEY,
  shop_id          TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  conversation_id  TEXT NOT NULL,
  channel          TEXT NOT NULL DEFAULT '',
  product          TEXT NOT NULL DEFAULT '',   -- สินค้าที่ AI เชียร์พ่วง (ไว้แมตช์ออเดอร์)
  est_value        INTEGER,                     -- มูลค่าที่เสนอเพิ่ม (บาท) จาก est_added_value
  created_at       BIGINT NOT NULL,
  -- B3 (เติมทีหลังตอนแมตช์ออเดอร์ — ตอนนี้ว่าง)
  sold             BOOLEAN NOT NULL DEFAULT false,
  sold_value       INTEGER,
  matched_order_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_upsell_events_shop ON upsell_events(shop_id);
```

The B3 columns ship now (nullable/default) so Plan B is a pure update, no migration churn.

---

## 4. Plan A — Offered Upsell (B1)

### 4.1 Capture the model's upsell signal
- Add `upsell_product` to the `REPLY_SYSTEM_PROMPT` output JSON: `"upsell_product": "ชื่อสินค้าที่เสนอพ่วง หรือ \"\""`.
- Extend `ReplyResult` (lib/claude.ts) to `{ message, needsHuman, reason, shouldUpsell, estAddedValue, upsellProduct }`. `generateReply` and `generateReplyWithTools` populate them (stop discarding). Existing fields unchanged, so current callers keep working.

### 4.2 Record only when sent to the customer
A new repo `lib/upsellRepo.ts`: `recordUpsell({ shopId, conversationId, channel, product, estValue })` and `upsellSummary(shopId, sinceMs)` → `{ count, totalEstValue }`.

- **Auto mode:** in `processAutoReply`, after a successful send, if `result.shouldUpsell` and `result.estAddedValue != null` → `recordUpsell(...)`.
- **Manual draft → admin sends:** the draft route already returns the (now-extended) `ReplyResult` to the frontend. When the admin sends that AI-drafted reply, the send call forwards `{ upsellProduct, estAddedValue }`; the send endpoint records the event. (The frontend passes back exactly what the draft returned — no client-side computation.)
- **Choices path:** out of scope for v1 (admin picks one of 2-3 options; no structured upsell value). Noted, not built.

Recording is best-effort: a failure to record must never block or fail the actual customer reply (wrap in try/catch, swallow).

### 4.3 Metrics API + dashboard
- `GET /api/metrics/upsell` → `{ count, totalEstValue }` for the current calendar month (server computes month start; `upsellSummary(shopId, monthStartMs)`).
- Dashboard tile: **"AI เสนอพ่วง (ส่งแล้ว): {count} ครั้ง · ฿{totalEstValue} เดือนนี้"**.

---

## 5. Plan B — Sold Upsell (B3) + Lazada Sales

### 5.1 Lazada sales total
- Extend order fetching to read order totals (Lazada `GetOrders` returns `price` per order). Sum over the period → **"ยอดขาย Lazada เดือนนี้ ฿X"**. Honest caveat on the tile: Lazada channel only.

### 5.2 Attribute upsells to real orders
- Periodically (or on order sync) for each recent un-sold `upsell_event` (created within an **attribution window of 7 days**):
  - For Lazada-chat conversations (buyer id known), fetch the buyer's recent orders + items.
  - If an order item **name matches the event's `product`** (case-insensitive contains), mark the event `sold = true`, set `sold_value` = that item's price, `matched_order_id`.
- Dashboard tiles: **"พ่วงขายได้จริง ฿{soldValue}"** and **"อัตราพ่วงสำเร็จ {soldCount}/{count}%"**.
- Correlation, not strict causation — acceptable and clearly the right directional signal; label as "ขายได้จริง" (appeared in an order after the AI upsold it).

### 5.3 Constraints
- Read-only order calls (mock-first, reuse `lib/lazadaOrders.ts`).
- Attribution only where buyer↔order is resolvable (Lazada chat). LINE/FB upsells stay in the "offered" count unless the customer's order is otherwise linkable (future).

---

## 6. Error Handling
- Recording upsell events is best-effort and never breaks a reply/send.
- Metrics APIs return zeros (`{ count: 0, totalEstValue: 0 }`) on no data — never error the dashboard.
- Order/attribution failures (API down, no permission) leave events un-sold; the dashboard still shows the "offered" numbers.

---

## 7. Testing
- **Unit (vitest):** `upsellSummary` aggregation (sum/count over a time window); the attribution matcher (product-name match within window → sold, with price); month-start computation.
- **Integration:** throwaway `mkt_` shop — insert upsell_events, hit the metrics query, assert totals; cleanup.
- No writes to real shop data.

---

## 8. Out of Scope
- Choices-path upsell capture.
- Non-Lazada order attribution (LINE/FB customers who bought elsewhere).
- Causal A/B proof of upsell lift (we report correlation, framed honestly).
- Shopee/TikTok sales totals (until those order APIs are live).
