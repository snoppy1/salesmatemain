import { describe, it, expect } from "vitest";
import { salesSince } from "@/lib/lazadaOrders";

describe("salesSince (mock token)", () => {
  it("returns a positive demo revenue", async () => {
    const out = await salesSince("mock-lazada", 0);
    expect(out.orderCount).toBeGreaterThan(0);
    expect(out.totalRevenue).toBeGreaterThan(0);
  });
});
