import { describe, it, expect } from "vitest";
import {
  extractSignals,
  selectRelevantProducts,
  RETRIEVAL_MIN_PRODUCTS,
} from "@/lib/catalogRetrieval";
import type { Product } from "@/lib/types";

function p(id: string, name: string, description = "", extra: Partial<Product> = {}): Product {
  return { id, name, description, price: "100", ...extra };
}

describe("extractSignals", () => {
  it("จับเลข+หน่วยได้ (48v, 30a, 20ah) แม้มีช่องว่างคั่น", () => {
    const { strong } = extractSignals("อยากได้ 48 V 20Ah จ่าย 30a");
    expect(strong).toContain("48v");
    expect(strong).toContain("20ah");
    expect(strong).toContain("30a");
  });

  it("ไม่สับสน ah กับ a (20ah ต้องไม่กลายเป็น 20a)", () => {
    const { strong } = extractSignals("แบต 20Ah");
    expect(strong).toContain("20ah");
    expect(strong).not.toContain("20a");
  });

  it("จับเลขรุ่นถ่าน 4-5 หลัก และรหัสรุ่นผสม", () => {
    const a = extractSignals("ถ่าน 18650 กับ 21700");
    expect(a.strong).toContain("18650");
    expect(a.strong).toContain("21700");
    const b = extractSignals("รุ่น bms150-200 ใช้ได้ไหม");
    expect(b.strong).toContain("bms150-200");
  });

  it("จับศัพท์เทคนิค/เคมี (lifepo4, bms, active balance)", () => {
    const { strong } = extractSignals("BMS active balance สำหรับ LiFePO4");
    expect(strong).toContain("lifepo4");
    expect(strong).toContain("bms");
    expect(strong).toContain("active");
    expect(strong).toContain("balance");
  });

  it("ตัดคำเชื่อม/คำลงท้ายออกจาก weak", () => {
    const { weak } = extractSignals("มีไหมครับ ราคาเท่าไหร่");
    expect(weak.has("มี")).toBe(false);
    expect(weak.has("ครับ")).toBe(false);
    expect(weak.has("ราคา")).toBe(false);
  });
});

describe("selectRelevantProducts", () => {
  it("ร้านสินค้าน้อย → useRetrieval=false คืนทั้งหมด", () => {
    const products = Array.from({ length: 5 }, (_, i) => p(`${i}`, `สินค้า ${i}`));
    const r = selectRelevantProducts(products, "อะไรก็ได้");
    expect(r.useRetrieval).toBe(false);
    expect(r.relevant).toHaveLength(5);
  });

  it("ร้านสินค้าเยอะ → useRetrieval=true และดึงเฉพาะที่ตรงคำถาม", () => {
    const products = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 6 }, (_, i) =>
      p(`${i}`, `สินค้าทั่วไป ${i}`, "คำอธิบายทั่วไป"),
    );
    products.push(p("bat", "แบตสามล้อไฟฟ้า 48V 20Ah Lifepo4", "BMS30A วิ่งไกล"));
    products.push(p("chg", "ที่ชาร์จจักรยานไฟฟ้า 5A", "ชาร์จไว"));

    const r = selectRelevantProducts(products, "แบต LiFePO4 48V 20Ah ใช้ได้กี่กิโล");
    expect(r.useRetrieval).toBe(true);
    expect(r.relevant.some((x) => x.id === "bat")).toBe(true);
    // สินค้าทั่วไปที่ไม่เกี่ยวต้องไม่ถูกดึง
    expect(r.relevant.some((x) => x.id === "0")).toBe(false);
  });

  it("จัดอันดับให้ของที่ตรงหลายสัญญาณมาก่อน", () => {
    const products = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 1 }, (_, i) =>
      p(`${i}`, `สินค้า ${i}`, "ทั่วไป"),
    );
    products.push(p("exact", "แบต 48V 20Ah LiFePO4", "ตรงเป๊ะ"));
    products.push(p("partial", "แบต 48V อื่นๆ", "ตรงบางส่วน"));

    const r = selectRelevantProducts(products, "แบต 48V 20Ah LiFePO4");
    expect(r.relevant[0].id).toBe("exact");
  });

  it("ทักทาย/ไม่เกี่ยวสินค้า → relevant อาจว่าง แต่ยัง useRetrieval=true", () => {
    const products = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 3 }, (_, i) =>
      p(`${i}`, `สินค้า ${i}`, "ทั่วไป"),
    );
    const r = selectRelevantProducts(products, "สวัสดีครับ");
    expect(r.useRetrieval).toBe(true);
    expect(r.relevant).toHaveLength(0);
  });

  it("ข้ามสินค้าที่ปิดการขาย (enabled=false)", () => {
    const products = Array.from({ length: RETRIEVAL_MIN_PRODUCTS + 1 }, (_, i) =>
      p(`${i}`, `สินค้า ${i}`, "ทั่วไป"),
    );
    products.push(p("off", "แบต 18650 พิเศษ", "เด็ด", { enabled: false }));
    const r = selectRelevantProducts(products, "ถ่าน 18650");
    expect(r.relevant.some((x) => x.id === "off")).toBe(false);
  });
});
