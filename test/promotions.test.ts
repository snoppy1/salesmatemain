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
