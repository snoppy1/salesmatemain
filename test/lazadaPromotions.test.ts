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
