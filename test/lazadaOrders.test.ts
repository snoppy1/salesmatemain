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
