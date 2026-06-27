import { describe, it, expect } from "vitest";
import { buildUserContent, buildUserContentParts } from "@/lib/prompt";
import { RETRIEVAL_MIN_PRODUCTS } from "@/lib/catalogRetrieval";
import type { Promotion, Product } from "@/lib/types";

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

describe("buildUserContentParts two-tier catalog (retrieval)", () => {
  function prod(id: string, name: string, description: string): Product {
    return { id, name, description, price: "100" };
  }

  it("ร้านสินค้าน้อย: ส่งคลังเต็มใน stable, ไม่มีบล็อกรายละเอียดแยก", () => {
    const products = [
      prod("a", "ถ่าน 18650", "ความจุ 3500mAh"),
      prod("b", "ที่ชาร์จ", "ชาร์จไว 5A"),
    ];
    const { stable, customer } = buildUserContentParts({
      shopName: "ร้าน", shopVoice: "", shopMemory: "", products, customerMsg: "ถ่าน 18650",
    });
    expect(stable).toContain("[คลังสินค้า");
    expect(stable).toContain("ความจุ 3500mAh"); // คำอธิบายอยู่ใน stable
    expect(customer).not.toContain("รายละเอียด/สเปกของสินค้าที่เกี่ยวกับคำถาม");
  });

  it("ร้านสินค้าเยอะ: stable เป็นดัชนีย่อ (ไม่มีคำอธิบายของที่ไม่เกี่ยว) + customer มีสเปกเต็มของที่เกี่ยว", () => {
    const products: Product[] = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 4 }, (_, i) =>
      prod(`${i}`, `สินค้าทั่วไป ${i}`, `คำอธิบายเฉพาะ-${i}-UNRELATED`),
    );
    products.push(prod("target", "ถ่าน 18650 Vapcell", "จ่ายไฟ 30A ความจุ 3500mAh RELEVANTDESC"));

    const { stable, customer } = buildUserContentParts({
      shopName: "ร้าน", shopVoice: "", shopMemory: "", products, customerMsg: "ถ่าน 18650 จ่ายกระแสเท่าไหร่",
    });

    // ดัชนีย่อแสดงชื่อทุกชิ้น (รวมของที่ไม่เกี่ยว) แต่ไม่มีคำอธิบายของที่ไม่เกี่ยว
    expect(stable).toContain("รายการสินค้าทั้งหมดในคลัง");
    expect(stable).toContain("สินค้าทั่วไป 0");
    expect(stable).not.toContain("UNRELATED");
    // สเปกเต็มของที่เกี่ยวอยู่ฝั่ง customer
    expect(customer).toContain("รายละเอียด/สเปกของสินค้าที่เกี่ยวกับคำถาม");
    expect(customer).toContain("RELEVANTDESC");
    expect(stable).not.toContain("RELEVANTDESC"); // ไม่ซ้ำใน stable
  });
});
