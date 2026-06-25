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
