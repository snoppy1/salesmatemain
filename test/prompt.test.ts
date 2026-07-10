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
    expect(stable).toContain("รายการสินค้าในคลัง");
    expect(stable).toContain("สินค้าทั่วไป 0");
    expect(stable).not.toContain("UNRELATED");
    // สเปกเต็มของที่เกี่ยวอยู่ฝั่ง customer
    expect(customer).toContain("รายละเอียด/สเปกของสินค้าที่เกี่ยวกับคำถาม");
    expect(customer).toContain("RELEVANTDESC");
    expect(stable).not.toContain("RELEVANTDESC"); // ไม่ซ้ำใน stable
  });
});

describe("ดัชนีย่อ: ยุบสินค้าหมดเป็นส่วนชื่ออย่างเดียว", () => {
  function prodS(id: string, name: string, stock?: number): Product {
    return { id, name, description: `คำอธิบาย-${id}`, price: "100", stock };
  }
  /** ร้านใหญ่พอให้เข้าโหมดดัชนีย่อ + มีของหมด 2 ตัว */
  function manyWithSoldOut(): Product[] {
    const arr = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 2 }, (_, i) =>
      prodS(`${i}`, `ของขายดี ${i}`, 5),
    );
    arr.push(prodS("out1", "วงจร BMS 8S 24V 25A สำหรับ Lifepo4 ทดสอบ", 0));
    arr.push(prodS("out2", "เครื่องชาร์จถ่านทดสอบ", 0));
    return arr;
  }
  const req = (products: Product[], customerMsg = "สวัสดีครับ") => ({
    shopName: "ร้าน", shopVoice: "", shopMemory: "", products, customerMsg,
  });

  it("ของหมดหายจากรายการหลัก ไปอยู่ส่วน [สินค้าที่ของหมดชั่วคราว] แบบชื่ออย่างเดียว (ไม่มีราคา/แท็ก)", () => {
    const { stable } = buildUserContentParts(req(manyWithSoldOut()));
    expect(stable).toContain("[สินค้าที่ของหมดชั่วคราว");
    const [main, outSection] = stable.split("[สินค้าที่ของหมดชั่วคราว");
    expect(main).not.toContain("วงจร BMS 8S 24V 25A");
    expect(outSection).toContain("วงจร BMS 8S 24V 25A");
    expect(outSection).not.toContain("ราคา 100 บาท");
    expect(outSection).not.toContain("[สินค้าหมด]");
    expect(outSection).not.toContain("[มีสต็อก]");
  });

  it("ไม่มีของหมด → ไม่มีส่วนของหมด (ข้อความเท่าเดิม)", () => {
    const products = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 2 }, (_, i) =>
      prodS(`${i}`, `ของขายดี ${i}`, 5),
    );
    const { stable } = buildUserContentParts(req(products));
    expect(stable).not.toContain("สินค้าที่ของหมดชั่วคราว");
  });

  it("ไม่รู้สต็อก (undefined) → ยังอยู่รายการหลัก ไม่โดนย้ายไปส่วนของหมด", () => {
    const products = manyWithSoldOut();
    products.push(prodS("nostock", "สินค้ากรอกมือไม่มีสต็อก"));
    const { stable } = buildUserContentParts(req(products));
    const [main] = stable.split("[สินค้าที่ของหมดชั่วคราว");
    expect(main).toContain("สินค้ากรอกมือไม่มีสต็อก");
  });

  it("ร้านเล็ก (คลังเต็ม): ของหมดยังแสดงบรรทัดเต็มพร้อมแท็ก [สินค้าหมด] เหมือนเดิม", () => {
    const products = [prodS("a", "ถ่าน 18650", 3), prodS("b", "ที่ชาร์จหมดสต็อก", 0)];
    const { stable } = buildUserContentParts(req(products));
    expect(stable).not.toContain("สินค้าที่ของหมดชั่วคราว");
    expect(stable).toContain("ที่ชาร์จหมดสต็อก");
    expect(stable).toContain("[สินค้าหมด]");
  });

  it("ลูกค้าถามถึงของหมด → retrieval ยังส่งสเปกเต็ม (ราคา+[สินค้าหมด]) ในฝั่ง customer", () => {
    const { customer } = buildUserContentParts(req(manyWithSoldOut(), "วงจร BMS 8S ราคาเท่าไหร่"));
    expect(customer).toContain("รายละเอียด/สเปกของสินค้าที่เกี่ยวกับคำถาม");
    expect(customer).toContain("วงจร BMS 8S 24V 25A");
    expect(customer).toContain("ราคา 100 บาท");
    expect(customer).toContain("[สินค้าหมด]");
  });

  it("สร้างซ้ำด้วย input เดิม → ได้ข้อความเดิมทุกไบต์ (แคชอยู่รอด)", () => {
    const a = buildUserContentParts(req(manyWithSoldOut()));
    const b = buildUserContentParts(req(manyWithSoldOut()));
    expect(a.stable).toBe(b.stable);
    expect(a.promo).toBe(b.promo);
  });
});
