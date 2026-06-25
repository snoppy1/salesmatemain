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
  it("track_shipment returns a string mentioning the order id", async () => {
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
