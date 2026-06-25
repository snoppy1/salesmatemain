# Lazada Orders & Shipping → AI Answers "Where's My Order" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI answer customer questions about their order status and shipment ("ของส่งถึงไหนแล้ว") by looking up live Lazada data mid-conversation via tool-calling — asking for the order number on LINE/FB, auto-looking-up on Lazada chat — while routing claims/refunds to a human.

**Architecture:** Add an Anthropic tool-use loop to the reply path (only when the message is about an order). The model can call `lookup_order`, `track_shipment`, `lookup_orders_by_buyer`; each tool calls a mock-first Lazada read API. The loop orchestration is a pure, injectable function (testable without network); the Lazada calls, intent detection, and tool schema/dispatch are isolated, pure-ish units. Claims/cancellations/refunds are escalated to a human deterministically.

**Tech Stack:** Next.js 16 + TypeScript, Anthropic `claude-sonnet-4-6` Messages API with `tools`, Postgres (Neon) via `pg`, vitest (already set up in the promotions phase).

## Global Constraints

- **Mock-first:** every new Lazada call has a mock fallback (mirrors `lib/marketplace.ts` `isLazadaConfigured()` + `accessToken.startsWith("mock")`). Real API only when configured AND token non-mock.
- **Read-only:** all order/logistics calls are GET. No write/cancel/refund actions against Lazada.
- **Safety (from spec §4.1):** AI answers directly ONLY for factual API results (status, tracking). Claims, cancellations, refunds, negotiation, complaints, money/edits → `needs_human = true`, routed to the seller, even in full-auto mode. On API error or order-not-found → AI does not guess; replies "ขอเช็คให้สักครู่" + `needs_human = true`.
- **Identity (from spec §3.5):** Lazada chat → conversation carries the marketplace buyer id (in `customers.line_user_id`, surfaced by `getSendTarget`) → auto buyer lookup allowed. LINE/Facebook → no buyer id → AI must ask for the order number first.
- **No destructive tests on real data:** integration uses throwaway `mkt_` shops; everything else is unit-tested with mock tokens.
- **Thai-language, no emoji** in AI-facing copy. Model: `claude-sonnet-4-6`.
- **Lazada Order/Logistics API access is NOT yet confirmed** for this seller app → real branches may return null/[]; mock covers demo. Do not block on it.

---

## File Structure

**New:**
- `lib/lazadaOrders.ts` — mock-first read-only Lazada order/logistics access + parsers + types (`OrderSummary`, `ShipmentTrace`, `OrderItem`).
- `lib/orderIntent.ts` — **pure** text helpers: `isOrderTopic`, `needsHumanForOrderTopic`, `extractOrderId`.
- `lib/toolLoop.ts` — **pure, injectable** Anthropic tool-use loop: `runToolLoop`, types `ModelTurn`, `ToolCall`.
- `test/lazadaOrders.test.ts`, `test/orderIntent.test.ts`, `test/toolLoop.test.ts`, `test/orderTools.test.ts` — unit tests.

**Modified:**
- `lib/prompt.ts` — add `ORDER_REPLY_SYSTEM_PROMPT` (instructs tool use, ask-for-order-number, factual-only, escalate claims).
- `lib/claude.ts` — add `buildOrderTools`, `dispatchOrderTool`, `generateReplyWithTools`.
- `lib/autoReply.ts` — route order-topic messages through the tool path; escalate claims.
- `app/api/line/draft/route.ts` — same routing for the manual "draft" button.

**Shared interfaces (defined once, used across tasks):**

```ts
// lib/lazadaOrders.ts
export type OrderItem = { name: string; quantity: number };
export type OrderSummary = {
  orderId: string;
  status: string;       // paid | packing | shipped | delivered | cancelled | ...
  statusText: string;   // ข้อความไทยอ่านรู้เรื่อง
  createdAt: number | null;
  items: OrderItem[];
};
export type ShipmentTrace = {
  orderId: string;
  status: string;        // logistics code เช่น in_transit | delivered
  statusText: string;    // "พัสดุถึงศูนย์คัดแยกบางนา กำลังนำจ่าย"
  trackingNumber: string;
  carrier: string;
  lastUpdate: number | null;
};
export function parseOrder(raw: Record<string, unknown>): OrderSummary | null;
export function parseTrace(raw: Record<string, unknown>): ShipmentTrace | null;
export function getOrder(accessToken: string, orderId: string): Promise<OrderSummary | null>;
export function traceShipment(accessToken: string, orderId: string): Promise<ShipmentTrace | null>;
export function getOrdersByBuyer(accessToken: string, buyerId: string): Promise<OrderSummary[]>;

// lib/orderIntent.ts
export function isOrderTopic(text: string): boolean;
export function needsHumanForOrderTopic(text: string): boolean;
export function extractOrderId(text: string): string | null;

// lib/toolLoop.ts
export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ModelTurn = { toolUse: boolean; assistantContent: unknown[]; toolCalls: ToolCall[]; text: string };
export function runToolLoop(params: {
  initialContent: unknown;
  callModel: (messages: { role: "user" | "assistant"; content: unknown }[]) => Promise<ModelTurn>;
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxRounds?: number;
}): Promise<string>;

// lib/claude.ts (additions)
export type OrderToolCtx = { token: string; buyerId: string | null; channel: string };
export function buildOrderTools(buyerId: string | null): unknown[];
export function dispatchOrderTool(name: string, input: Record<string, unknown>, ctx: OrderToolCtx): Promise<string>;
export function generateReplyWithTools(req: GenerateRequest, ctx: OrderToolCtx): Promise<ReplyResult>;
```

`ReplyResult` and `GenerateRequest` already exist (`{ message, needsHuman, reason }` and the prompt request type).

---

## Task 1: Order/shipment types + mock data + parsers

**Files:**
- Create: `lib/lazadaOrders.ts`, `test/lazadaOrders.test.ts`

**Interfaces:**
- Consumes: `isLazadaConfigured` from `lib/marketplace.ts`.
- Produces: `OrderItem`, `OrderSummary`, `ShipmentTrace`, `parseOrder`, `parseTrace`, `getOrder`, `traceShipment`, `getOrdersByBuyer`.

- [ ] **Step 1: Write the failing test**

Create `test/lazadaOrders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseOrder, parseTrace, getOrder, traceShipment, getOrdersByBuyer } from "@/lib/lazadaOrders";

describe("parseOrder", () => {
  it("maps fields + items", () => {
    const raw = {
      order_id: 12345,
      statuses: ["shipped"],
      created_at: "1700000000000",
      items: [{ name: "หูฟัง", quantity: 2 }],
    };
    const o = parseOrder(raw);
    expect(o).toMatchObject({ orderId: "12345", status: "shipped", createdAt: 1700000000000 });
    expect(o?.items).toEqual([{ name: "หูฟัง", quantity: 2 }]);
  });
  it("missing order_id → null", () => {
    expect(parseOrder({})).toBeNull();
  });
});

describe("parseTrace", () => {
  it("maps tracking fields", () => {
    const raw = {
      order_id: 12345,
      status: "in_transit",
      detail: "ถึงศูนย์คัดแยกบางนา",
      tracking_number: "TH123",
      carrier: "Flash",
      updated_at: "1700000500000",
    };
    const t = parseTrace(raw);
    expect(t).toMatchObject({
      orderId: "12345", status: "in_transit", statusText: "ถึงศูนย์คัดแยกบางนา",
      trackingNumber: "TH123", carrier: "Flash", lastUpdate: 1700000500000,
    });
  });
  it("missing order_id → null", () => {
    expect(parseTrace({})).toBeNull();
  });
});

describe("mock fetchers (mock token)", () => {
  it("getOrder returns a summary; NOTFOUND id → null", async () => {
    expect(await getOrder("mock", "A1")).not.toBeNull();
    expect(await getOrder("mock", "NOTFOUND")).toBeNull();
  });
  it("traceShipment returns a trace; NOTFOUND id → null", async () => {
    const t = await traceShipment("mock", "A1");
    expect(t?.trackingNumber.length).toBeGreaterThan(0);
    expect(await traceShipment("mock", "NOTFOUND")).toBeNull();
  });
  it("getOrdersByBuyer returns at least one order", async () => {
    expect((await getOrdersByBuyer("mock", "buyer-1")).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lazadaOrders.test.ts`
Expected: FAIL — cannot resolve `@/lib/lazadaOrders`.

- [ ] **Step 3: Implement `lib/lazadaOrders.ts`**

Create `lib/lazadaOrders.ts`:

```ts
import "server-only";
import { createHmac } from "node:crypto";
import { isLazadaConfigured } from "./marketplace";

export type OrderItem = { name: string; quantity: number };
export type OrderSummary = {
  orderId: string;
  status: string;
  statusText: string;
  createdAt: number | null;
  items: OrderItem[];
};
export type ShipmentTrace = {
  orderId: string;
  status: string;
  statusText: string;
  trackingNumber: string;
  carrier: string;
  lastUpdate: number | null;
};

const API_BASE = process.env.LAZADA_API_BASE || "https://api.lazada.co.th/rest";
// NOTE: ยืนยัน endpoint + สิทธิ์ Order/Logistics ใน Lazada console ก่อนใช้จริง
const ORDER_PATH = "/order/get";
const ITEMS_PATH = "/order/items/get";
const TRACE_PATH = "/logistic/order/trace";
const ORDERS_PATH = "/orders/get";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const STATUS_TEXT: Record<string, string> = {
  paid: "ชำระเงินแล้ว กำลังเตรียมจัดส่ง",
  packing: "ร้านกำลังแพ็คสินค้า",
  shipped: "จัดส่งแล้ว กำลังนำส่ง",
  delivered: "จัดส่งสำเร็จแล้ว",
  cancelled: "ออเดอร์ถูกยกเลิก",
};

export function parseOrder(raw: Record<string, unknown>): OrderSummary | null {
  const id = raw.order_id;
  if (id == null || String(id) === "") return null;
  const statuses = (raw.statuses as unknown[]) ?? [];
  const status = String(Array.isArray(statuses) ? statuses[0] ?? "" : raw.status ?? "").trim();
  const itemsRaw = (raw.items as unknown[]) ?? [];
  const items: OrderItem[] = Array.isArray(itemsRaw)
    ? itemsRaw.map((it) => {
        const x = (it ?? {}) as Record<string, unknown>;
        return { name: String(x.name ?? "").trim(), quantity: Number(x.quantity ?? 1) || 1 };
      })
    : [];
  return {
    orderId: String(id),
    status,
    statusText: STATUS_TEXT[status] ?? status ?? "",
    createdAt: num(raw.created_at),
    items,
  };
}

export function parseTrace(raw: Record<string, unknown>): ShipmentTrace | null {
  const id = raw.order_id;
  if (id == null || String(id) === "") return null;
  return {
    orderId: String(id),
    status: String(raw.status ?? "").trim(),
    statusText: String(raw.detail ?? raw.status_text ?? "").trim(),
    trackingNumber: String(raw.tracking_number ?? "").trim(),
    carrier: String(raw.carrier ?? "").trim(),
    lastUpdate: num(raw.updated_at),
  };
}

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort();
  const base = path + sorted.map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

async function signedGet(
  path: string,
  accessToken: string,
  extra: Record<string, string>,
): Promise<Record<string, unknown>> {
  const appKey = process.env.LAZADA_APP_KEY as string;
  const appSecret = process.env.LAZADA_APP_SECRET as string;
  const params: Record<string, string> = {
    app_key: appKey,
    access_token: accessToken,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    ...extra,
  };
  params.sign = sign(path, params, appSecret);
  const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`, { method: "GET" });
  return (await res.json()) as Record<string, unknown>;
}

function isMock(token: string): boolean {
  return !isLazadaConfigured() || token.startsWith("mock");
}

function mockOrder(orderId: string): OrderSummary {
  return {
    orderId,
    status: "shipped",
    statusText: STATUS_TEXT.shipped,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    items: [{ name: "หูฟังบลูทูธ TWS", quantity: 1 }],
  };
}

export async function getOrder(accessToken: string, orderId: string): Promise<OrderSummary | null> {
  if (orderId.toUpperCase().includes("NOTFOUND")) return null;
  if (isMock(accessToken)) return mockOrder(orderId);
  try {
    const data = await signedGet(ORDER_PATH, accessToken, { order_id: orderId });
    const order = (data.data ?? data) as Record<string, unknown>;
    const parsed = parseOrder(order);
    if (!parsed) return null;
    const itemsData = await signedGet(ITEMS_PATH, accessToken, { order_id: orderId });
    const itemList = ((itemsData.data as unknown[]) ?? []).map((it) => {
      const x = (it ?? {}) as Record<string, unknown>;
      return { name: String(x.name ?? "").trim(), quantity: Number(x.quantity ?? 1) || 1 };
    });
    if (itemList.length) parsed.items = itemList;
    return parsed;
  } catch {
    return null;
  }
}

export async function traceShipment(accessToken: string, orderId: string): Promise<ShipmentTrace | null> {
  if (orderId.toUpperCase().includes("NOTFOUND")) return null;
  if (isMock(accessToken)) {
    return {
      orderId,
      status: "in_transit",
      statusText: "พัสดุถึงศูนย์คัดแยกบางนา กำลังนำจ่าย",
      trackingNumber: "TH" + orderId,
      carrier: "Flash Express",
      lastUpdate: Date.now() - 1000 * 60 * 60 * 3,
    };
  }
  try {
    const data = await signedGet(TRACE_PATH, accessToken, { order_id: orderId });
    return parseTrace((data.data ?? data) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getOrdersByBuyer(accessToken: string, buyerId: string): Promise<OrderSummary[]> {
  if (isMock(accessToken)) return [mockOrder("MOCK-" + buyerId.slice(0, 6))];
  try {
    const data = await signedGet(ORDERS_PATH, accessToken, { buyer_id: buyerId, limit: "5" });
    const list = ((data.data as Record<string, unknown>)?.orders as unknown[]) ?? [];
    return list.map((o) => parseOrder(o as Record<string, unknown>)).filter((o): o is OrderSummary => o !== null);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lazadaOrders.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/lazadaOrders.ts test/lazadaOrders.test.ts
git commit -m "feat: Lazada orders + shipment trace (mock-first) + parsers"
```

---

## Task 2: Order intent helpers (pure)

**Files:**
- Create: `lib/orderIntent.ts`, `test/orderIntent.test.ts`

**Interfaces:**
- Produces: `isOrderTopic(text)`, `needsHumanForOrderTopic(text)`, `extractOrderId(text)`.

- [ ] **Step 1: Write the failing test**

Create `test/orderIntent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isOrderTopic, needsHumanForOrderTopic, extractOrderId } from "@/lib/orderIntent";

describe("isOrderTopic", () => {
  it("detects shipping/order questions", () => {
    expect(isOrderTopic("ของส่งถึงไหนแล้วคะ")).toBe(true);
    expect(isOrderTopic("เลขพัสดุอะไรคะ")).toBe(true);
    expect(isOrderTopic("ออเดอร์ของหนูสถานะไง")).toBe(true);
  });
  it("ignores normal product chat", () => {
    expect(isOrderTopic("หูฟังราคาเท่าไหร่")).toBe(false);
  });
});

describe("needsHumanForOrderTopic", () => {
  it("escalates claims/cancel/refund", () => {
    expect(needsHumanForOrderTopic("ขอยกเลิกออเดอร์")).toBe(true);
    expect(needsHumanForOrderTopic("ขอคืนเงินด้วยค่ะ")).toBe(true);
    expect(needsHumanForOrderTopic("ของชำรุดขอเคลม")).toBe(true);
  });
  it("does not escalate plain status questions", () => {
    expect(needsHumanForOrderTopic("ของส่งถึงไหนแล้ว")).toBe(false);
  });
});

describe("extractOrderId", () => {
  it("pulls a long digit/letter run", () => {
    expect(extractOrderId("ออเดอร์ 123456789")).toBe("123456789");
    expect(extractOrderId("เลข TH12345678")).toBe("TH12345678");
  });
  it("returns null when none", () => {
    expect(extractOrderId("ของส่งยัง")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orderIntent.test.ts`
Expected: FAIL — cannot resolve `@/lib/orderIntent`.

- [ ] **Step 3: Implement `lib/orderIntent.ts`**

Create `lib/orderIntent.ts`:

```ts
// คีย์เวิร์ดบ่งบอกว่าลูกค้าถามเรื่องออเดอร์/การจัดส่ง
const ORDER_KEYWORDS = [
  "ส่งถึงไหน", "ส่งยัง", "พัสดุ", "เลขพัสดุ", "tracking", "ออเดอร์", "order",
  "สถานะ", "ของยัง", "เมื่อไหร่จะถึง", "ถึงเมื่อไหร่", "จัดส่ง", "ขนส่ง", "เลขออเดอร์",
];

// เรื่องที่ต้องส่งให้คนตอบเสมอ (เคลม/ยกเลิก/คืนเงิน/ร้องเรียน)
const ESCALATE_KEYWORDS = [
  "ยกเลิก", "คืนเงิน", "คืนของ", "เคลม", "ชำรุด", "ของเสีย", "ของผิด", "ไม่ได้รับของ",
  "ร้องเรียน", "refund", "cancel", "claim", "เงินคืน", "ผิดรุ่น", "ส่งผิด",
];

function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

/** ข้อความนี้เกี่ยวกับออเดอร์/การจัดส่งไหม (ตัดสินใจว่าจะเปิด tool ค้นออเดอร์) */
export function isOrderTopic(text: string): boolean {
  return hasAny(text, ORDER_KEYWORDS);
}

/** ต้องส่งให้คนตอบไหม (เคลม/ยกเลิก/คืนเงิน ฯลฯ) — บังคับ escalate แม้ full auto */
export function needsHumanForOrderTopic(text: string): boolean {
  return hasAny(text, ESCALATE_KEYWORDS);
}

/** ดึงเลขออเดอร์/พัสดุจากข้อความ (กลุ่มตัวอักษร+ตัวเลขยาว >= 6) — null ถ้าไม่เจอ */
export function extractOrderId(text: string): string | null {
  const m = text.match(/[A-Za-z0-9]{6,}/);
  return m ? m[0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orderIntent.test.ts`
Expected: PASS — `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/orderIntent.ts test/orderIntent.test.ts
git commit -m "feat: order intent helpers (topic, escalation, order-id extract)"
```

---

## Task 3: Tool-use loop (pure, injectable)

**Files:**
- Create: `lib/toolLoop.ts`, `test/toolLoop.test.ts`

**Interfaces:**
- Produces: `ToolCall`, `ModelTurn`, `runToolLoop`.

- [ ] **Step 1: Write the failing test**

Create `test/toolLoop.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runToolLoop, type ModelTurn } from "@/lib/toolLoop";

describe("runToolLoop", () => {
  it("runs a requested tool then returns the final text", async () => {
    const turns: ModelTurn[] = [
      { toolUse: true, assistantContent: [{ type: "tool_use", id: "t1", name: "track_shipment", input: { orderId: "A1" } }],
        toolCalls: [{ id: "t1", name: "track_shipment", input: { orderId: "A1" } }], text: "" },
      { toolUse: false, assistantContent: [], toolCalls: [], text: '{"message":"พัสดุกำลังมาค่ะ"}' },
    ];
    const callModel = vi.fn(async () => turns.shift() as ModelTurn);
    const runTool = vi.fn(async () => "status: in_transit");

    const out = await runToolLoop({ initialContent: "ของส่งถึงไหน", callModel, runTool });

    expect(runTool).toHaveBeenCalledWith("track_shipment", { orderId: "A1" });
    expect(out).toBe('{"message":"พัสดุกำลังมาค่ะ"}');
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("stops at maxRounds and returns last text if model keeps calling tools", async () => {
    const callModel = vi.fn(async (): Promise<ModelTurn> => ({
      toolUse: true, assistantContent: [{ type: "tool_use", id: "x", name: "lookup_order", input: {} }],
      toolCalls: [{ id: "x", name: "lookup_order", input: {} }], text: "ขอเช็คก่อนนะคะ",
    }));
    const runTool = vi.fn(async () => "ok");

    const out = await runToolLoop({ initialContent: "x", callModel, runTool, maxRounds: 2 });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(out).toBe("ขอเช็คก่อนนะคะ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/toolLoop.test.ts`
Expected: FAIL — cannot resolve `@/lib/toolLoop`.

- [ ] **Step 3: Implement `lib/toolLoop.ts`**

Create `lib/toolLoop.ts`:

```ts
export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ModelTurn = {
  toolUse: boolean;       // โมเดลขอเรียก tool ในรอบนี้ไหม
  assistantContent: unknown[]; // content blocks ของ assistant (ส่งกลับเข้า messages ตามรูปแบบ Anthropic)
  toolCalls: ToolCall[];  // tool ที่ขอเรียก
  text: string;           // ข้อความ (คำตอบสุดท้าย หรือ fallback)
};

type Message = { role: "user" | "assistant"; content: unknown };

/**
 * วนลูป tool-use ของ Anthropic แบบ pure: ฉีด callModel + runTool เข้ามา (เทสต์ได้โดยไม่ต้องต่อเน็ต)
 * - โมเดลขอ tool → รัน runTool ทุกตัว → ใส่ tool_result กลับ → วนต่อ
 * - โมเดลตอบจบ หรือครบ maxRounds → คืนข้อความสุดท้าย
 */
export async function runToolLoop(params: {
  initialContent: unknown;
  callModel: (messages: Message[]) => Promise<ModelTurn>;
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxRounds?: number;
}): Promise<string> {
  const { initialContent, callModel, runTool, maxRounds = 4 } = params;
  const messages: Message[] = [{ role: "user", content: initialContent }];
  let lastText = "";

  for (let round = 0; round < maxRounds; round++) {
    const turn = await callModel(messages);
    lastText = turn.text;
    if (!turn.toolUse || turn.toolCalls.length === 0) {
      return turn.text;
    }
    messages.push({ role: "assistant", content: turn.assistantContent });
    const results = [];
    for (const call of turn.toolCalls) {
      const result = await runTool(call.name, call.input);
      results.push({ type: "tool_result", tool_use_id: call.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }
  // ครบ maxRounds แล้วยังขอ tool อยู่ → คืนข้อความสุดท้ายที่โมเดลให้มา (กันลูปไม่จบ)
  return lastText;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/toolLoop.test.ts`
Expected: PASS — `2 passed`. (The loop calls `callModel` exactly `maxRounds` times — no extra post-loop call — so the maxRounds test sees 2 calls and returns the last turn's text.)

- [ ] **Step 5: Commit**

```bash
git add lib/toolLoop.ts test/toolLoop.test.ts
git commit -m "feat: pure injectable Anthropic tool-use loop"
```

---

## Task 4: Order tools schema + dispatcher + generateReplyWithTools

**Files:**
- Modify: `lib/prompt.ts` (add `ORDER_REPLY_SYSTEM_PROMPT`), `lib/claude.ts`
- Create: `test/orderTools.test.ts`

**Interfaces:**
- Consumes: `getOrder`, `traceShipment`, `getOrdersByBuyer` (lazadaOrders); `runToolLoop` (toolLoop); `ORDER_REPLY_SYSTEM_PROMPT`, `buildUserContent`, `parseModelJson` (prompt).
- Produces: `OrderToolCtx`, `buildOrderTools(buyerId)`, `dispatchOrderTool(name, input, ctx)`, `generateReplyWithTools(req, ctx)`.

- [ ] **Step 1: Add the order system prompt**

In `lib/prompt.ts`, add after `CHOICES_SYSTEM_PROMPT`:

```ts
/** สำหรับคำถามเรื่องออเดอร์/จัดส่ง: ใช้ tool ค้นข้อมูลจริงก่อนตอบ */
export const ORDER_REPLY_SYSTEM_PROMPT = `คุณคือแอดมินร้านที่กำลังตอบแชตลูกค้าเรื่อง "ออเดอร์/การจัดส่ง"
คุณมีเครื่องมือค้นข้อมูลจริง: lookup_order (ดูสถานะออเดอร์), track_shipment (เช็คว่าพัสดุถึงไหน), lookup_orders_by_buyer (ดูออเดอร์ของลูกค้ารายนี้ ถ้ามี)

วิธีทำงาน:
1. ถ้ายังไม่รู้เลขออเดอร์และไม่มีเครื่องมือ lookup_orders_by_buyer ให้ "ถามเลขออเดอร์จากลูกค้าก่อน" อย่างสุภาพ (เช่น "ขอเลขออเดอร์หน่อยค่ะ") แล้วจบรอบ ไม่ต้องเรียก tool
2. ถ้ารู้เลขออเดอร์ (ลูกค้าให้มา) ให้เรียก tool ที่เหมาะ แล้วตอบลูกค้าด้วย "ข้อมูลจริงจาก tool เท่านั้น" — ห้ามเดา/แต่งสถานะหรือเลขพัสดุเอง
3. ถ้า tool คืนค่าว่าง/หาไม่เจอ/ผิดพลาด → อย่าเดา ให้ตอบว่าขอเช็คให้สักครู่ และตั้ง needs_human = true
4. เรื่องเคลม/ยกเลิก/คืนเงิน/ต่อรอง/ร้องเรียน → ห้ามจัดการเอง ตอบรับเรื่องสุภาพ แล้วตั้ง needs_human = true เสมอ
5. ตอบสั้น กระชับ เป็นธรรมชาติ ภาษาไทย ห้ามอีโมจิ

ตอบกลับสุดท้ายเป็น JSON เท่านั้น (หลังเรียก tool เสร็จ):
{"needs_human": true/false, "message": "ข้อความตอบลูกค้าพร้อมส่ง (ห้ามว่าง)", "reason_for_admin": "บริบทสั้นๆ ให้แอดมิน"}`;
```

- [ ] **Step 2: Write the failing test (tools schema + dispatcher)**

Create `test/orderTools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOrderTools, dispatchOrderTool } from "@/lib/claude";

describe("buildOrderTools", () => {
  it("includes lookup_orders_by_buyer only when a buyerId is known", () => {
    const withBuyer = buildOrderTools("buyer-1").map((t) => (t as { name: string }).name);
    const noBuyer = buildOrderTools(null).map((t) => (t as { name: string }).name);
    expect(withBuyer).toContain("lookup_orders_by_buyer");
    expect(withBuyer).toContain("lookup_order");
    expect(withBuyer).toContain("track_shipment");
    expect(noBuyer).not.toContain("lookup_orders_by_buyer");
    expect(noBuyer).toContain("lookup_order");
  });
});

describe("dispatchOrderTool (mock token)", () => {
  const ctx = { token: "mock-lazada", buyerId: "buyer-1", channel: "lazada" };
  it("track_shipment returns a string mentioning tracking", async () => {
    const out = await dispatchOrderTool("track_shipment", { orderId: "A1" }, ctx);
    expect(out).toContain("A1");
  });
  it("lookup_order for NOTFOUND says not found", async () => {
    const out = await dispatchOrderTool("lookup_order", { orderId: "NOTFOUND" }, ctx);
    expect(out).toContain("ไม่พบ");
  });
  it("unknown tool name → error string", async () => {
    const out = await dispatchOrderTool("nope", {}, ctx);
    expect(out).toContain("ไม่รู้จัก");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/orderTools.test.ts`
Expected: FAIL — `buildOrderTools`/`dispatchOrderTool` not exported from `@/lib/claude`.

- [ ] **Step 4: Implement tools schema, dispatcher, and the tool-using reply in `lib/claude.ts`**

In `lib/claude.ts`, update the imports at the top:

```ts
import "server-only";
import type { GenerateRequest } from "./types";
import {
  REPLY_SYSTEM_PROMPT,
  CHOICES_SYSTEM_PROMPT,
  ORDER_REPLY_SYSTEM_PROMPT,
  buildUserContent,
  parseModelJson,
} from "./prompt";
import { getOrder, traceShipment, getOrdersByBuyer } from "./lazadaOrders";
import { runToolLoop, type ModelTurn } from "./toolLoop";
```

Then append to the end of `lib/claude.ts`:

```ts
export type OrderToolCtx = { token: string; buyerId: string | null; channel: string };

/** นิยาม tool ให้ Claude — ใส่ lookup_orders_by_buyer เฉพาะตอนรู้ buyer (แชต Lazada) */
export function buildOrderTools(buyerId: string | null): unknown[] {
  const tools: unknown[] = [
    {
      name: "lookup_order",
      description: "ดูสถานะออเดอร์จากเลขออเดอร์",
      input_schema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    },
    {
      name: "track_shipment",
      description: "เช็คว่าพัสดุของออเดอร์นี้ส่งถึงไหนแล้ว จากเลขออเดอร์",
      input_schema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    },
  ];
  if (buyerId) {
    tools.push({
      name: "lookup_orders_by_buyer",
      description: "ดูรายการออเดอร์ล่าสุดของลูกค้ารายนี้ (รู้ตัวตนจากแชต)",
      input_schema: { type: "object", properties: {}, required: [] },
    });
  }
  return tools;
}

/** รัน tool จริง (ค้นข้อมูล Lazada) แล้วคืนผลเป็นข้อความให้โมเดลอ่าน */
export async function dispatchOrderTool(
  name: string,
  input: Record<string, unknown>,
  ctx: OrderToolCtx,
): Promise<string> {
  const orderId = String(input.orderId ?? "").trim();
  if (name === "lookup_order") {
    const o = await getOrder(ctx.token, orderId);
    if (!o) return "ไม่พบออเดอร์นี้";
    return `ออเดอร์ ${o.orderId}: สถานะ ${o.statusText} | สินค้า: ${o.items.map((i) => `${i.name} x${i.quantity}`).join(", ")}`;
  }
  if (name === "track_shipment") {
    const t = await traceShipment(ctx.token, orderId);
    if (!t) return "ไม่พบข้อมูลการจัดส่งของออเดอร์นี้";
    return `ออเดอร์ ${t.orderId}: ${t.statusText} | ขนส่ง ${t.carrier} | เลขพัสดุ ${t.trackingNumber}`;
  }
  if (name === "lookup_orders_by_buyer") {
    if (!ctx.buyerId) return "ไม่ทราบตัวตนลูกค้า";
    const orders = await getOrdersByBuyer(ctx.token, ctx.buyerId);
    if (!orders.length) return "ไม่พบออเดอร์ของลูกค้ารายนี้";
    return orders.map((o) => `ออเดอร์ ${o.orderId}: ${o.statusText}`).join("\n");
  }
  return "ไม่รู้จักเครื่องมือนี้";
}

/** ตอบเรื่องออเดอร์/จัดส่งโดยใช้ tool ค้นข้อมูลจริงก่อน (Anthropic tool-use loop) */
export async function generateReplyWithTools(
  req: GenerateRequest,
  ctx: OrderToolCtx,
): Promise<ReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ฝั่งเซิร์ฟเวอร์", 500);
  }
  const tools = buildOrderTools(ctx.buyerId);

  const callModel = async (
    messages: { role: "user" | "assistant"; content: unknown }[],
  ): Promise<ModelTurn> => {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 900,
          system: ORDER_REPLY_SYSTEM_PROMPT,
          tools,
          messages,
        }),
      });
    } catch {
      throw new ClaudeError("เชื่อมต่อ Anthropic API ไม่สำเร็จ", 502);
    }
    if (!res.ok) {
      throw new ClaudeError(`Anthropic API ตอบกลับผิดพลาด (${res.status})`, 502);
    }
    const data = (await res.json().catch(() => null)) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    } | null;
    const content = data?.content ?? [];
    const toolCalls = content
      .filter((c) => c.type === "tool_use")
      .map((c) => ({ id: c.id ?? "", name: c.name ?? "", input: (c.input ?? {}) as Record<string, unknown> }));
    const text = content.find((c) => c.type === "text")?.text ?? "";
    return { toolUse: data?.stop_reason === "tool_use", assistantContent: content, toolCalls, text };
  };

  const finalText = await runToolLoop({
    initialContent: buildUserContent(req),
    callModel,
    runTool: (name, input) => dispatchOrderTool(name, input, ctx),
  });

  let obj: Record<string, unknown> = {};
  try {
    obj = parseModelJson(finalText) as Record<string, unknown>;
  } catch {
    // โมเดลตอบเป็นข้อความล้วน (เช่น ถามเลขออเดอร์) → ใช้เป็น message ตรงๆ
    return { message: finalText.trim(), needsHuman: false, reason: "" };
  }
  return {
    message: typeof obj.message === "string" ? obj.message : finalText.trim(),
    needsHuman: Boolean(obj.needs_human),
    reason: typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/orderTools.test.ts`
Expected: PASS — `5 passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt.ts lib/claude.ts test/orderTools.test.ts
git commit -m "feat: order tools schema + dispatcher + generateReplyWithTools"
```

---

## Task 5: Wire the tool path into autoReply + the draft route

**Files:**
- Modify: `lib/autoReply.ts`, `app/api/line/draft/route.ts`

**Interfaces:**
- Consumes: `isOrderTopic`, `needsHumanForOrderTopic` (orderIntent); `generateReplyWithTools`, `OrderToolCtx` (claude); `getValidAccessToken` (connectionRepo); `getSendTarget` (inboxRepo).

- [ ] **Step 1: Route order-topic messages through tools in `autoReply.ts`**

In `lib/autoReply.ts`, add imports:

```ts
import { generateReply, generateReplyWithTools } from "./claude";
import { isOrderTopic, needsHumanForOrderTopic } from "./orderIntent";
import { getValidAccessToken } from "./connectionRepo";
```

(Replace the existing `import { generateReply } from "./claude";` line with the first line above.)

Then, in `processAutoReply`, replace the existing `const result = await generateReply({ ... });` block with:

```ts
    // ข้อความล่าสุดของลูกค้า (ใช้เช็คว่าเป็นคำถามออเดอร์ไหม)
    const lastCustomerText =
      [...convo.messages].reverse().find((m) => m.sender === "customer")?.text ?? "";

    const baseReq = {
      shopName: shopData.shop.name,
      shopVoice: shopData.shop.voice,
      shopMemory: shopData.shop.memory,
      products: shopData.products,
      promotions,
      customerMsg: ctx.text,
      imageUrls: ctx.imageUrls,
    };

    let result;
    if (isOrderTopic(lastCustomerText)) {
      const target = await getSendTarget(shopId, conversationId);
      const token = (await getValidAccessToken(shopId, "lazada")) ?? "mock-lazada";
      const buyerId = convo.channel === "lazada" ? target?.lineUserId ?? null : null;
      result = await generateReplyWithTools(baseReq, { token, buyerId, channel: convo.channel });
    } else {
      result = await generateReply(baseReq);
    }

    // เคลม/ยกเลิก/คืนเงิน → บังคับส่งให้คนตอบเสมอ (แม้ full auto)
    if (needsHumanForOrderTopic(lastCustomerText)) {
      result = { ...result, needsHuman: true };
    }
```

(`getSendTarget` is already imported in `autoReply.ts`.)

- [ ] **Step 2: Type-check via build**

Run: `npx next build`
Expected: `Compiled successfully` (no type errors).

- [ ] **Step 3: Route the draft route through tools**

In `app/api/line/draft/route.ts`, add imports:

```ts
import { generateReply, generateReplyWithTools, ClaudeError } from "@/lib/claude";
import { isOrderTopic, needsHumanForOrderTopic } from "@/lib/orderIntent";
import { getValidAccessToken } from "@/lib/connectionRepo";
import { getSendTarget } from "@/lib/inboxRepo";
```

(Replace the existing `import { generateReply, ClaudeError } from "@/lib/claude";` line.)

Replace the `try { const result = await generateReply({ ... }); return NextResponse.json(result); }` block with:

```ts
  const lastCustomerText =
    [...convo.messages].reverse().find((m) => m.sender === "customer")?.text ?? "";
  const baseReq = {
    shopName: shopData.shop.name,
    shopVoice: shopData.shop.voice,
    shopMemory: shopData.shop.memory,
    products: shopData.products,
    promotions,
    customerMsg: ctx.text,
    imageUrls: ctx.imageUrls,
  };

  try {
    let result;
    if (isOrderTopic(lastCustomerText)) {
      const target = await getSendTarget(admin.shopId, body.conversationId);
      const token = (await getValidAccessToken(admin.shopId, "lazada")) ?? "mock-lazada";
      const buyerId = convo.channel === "lazada" ? target?.lineUserId ?? null : null;
      result = await generateReplyWithTools(baseReq, { token, buyerId, channel: convo.channel });
    } else {
      result = await generateReply(baseReq);
    }
    if (needsHumanForOrderTopic(lastCustomerText)) {
      result = { ...result, needsHuman: true };
    }
    return NextResponse.json(result);
  } catch (e) {
    const err = e as ClaudeError;
    return NextResponse.json(
      { error: err.message || "ร่างคำตอบไม่สำเร็จ" },
      { status: err.status || 502 },
    );
  }
```

- [ ] **Step 4: Run the whole unit suite + build**

Run: `npx vitest run`
Expected: PASS — all tests green (promotions phase + orders phase).

Run: `npx next build`
Expected: `Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add lib/autoReply.ts app/api/line/draft/route.ts
git commit -m "feat: route order/shipping questions through the AI tool path"
```

---

## Manual verification (after Task 5)

1. `npm run dev`, log into a test shop. In the inbox simulator, send a LINE message "ของส่งถึงไหนแล้ว". Expected: AI asks for the order number (no order id yet, LINE has no buyer id).
2. Reply "123456789". Expected: AI calls `track_shipment` (mock) and answers with the mock status + tracking number "TH123456789".
3. Send "ขอยกเลิกออเดอร์ 123456789". Expected: AI does NOT auto-resolve; conversation is set to "รอตอบ" (`needs_human`).

---

## Out of Scope (this plan)
- Real Lazada order/logistics endpoint wiring is mock-backed until API permission is confirmed (endpoints are placeholders in `lib/lazadaOrders.ts` constants, clearly commented).
- Shopee/TikTok orders.
- Order write actions (cancel/edit/refund automation).
- Tool use in the multi-choice (`/api/line/choices`) path — single-reply paths only for now.
- Upsell measurement metric (deferred per user; revisit after this phase — see memory `salesmate-upsell-differentiator`).
```
