import { describe, it, expect } from "vitest";
import { extractVariantOptions, withVariantNote, replaceVariantNote } from "@/lib/marketplace";

describe("extractVariantOptions", () => {
  it("ดึงสีจากทุก SKU ไม่ซ้ำ ตามลำดับที่เจอ", () => {
    const skus = [
      { saleProp: { color_family: "สีส้ม" }, price: 499 },
      { saleProp: { color_family: "สีเขียว" }, price: 499 },
      { saleProp: { color_family: "สีส้ม" }, price: 499 }, // ซ้ำ → ไม่นับเพิ่ม
    ];
    expect(extractVariantOptions(skus)).toBe("สีส้ม/สีเขียว");
  });

  it("ค่าเดียว = ไม่มีตัวเลือก → ว่าง", () => {
    expect(extractVariantOptions([{ saleProp: { color_family: "สีดำ" } }])).toBe("");
  });

  it("ไม่มี saleProp เลย → ว่าง (สินค้าไม่มีตัวเลือก)", () => {
    expect(extractVariantOptions([{ price: 100 }])).toBe("");
    expect(extractVariantOptions([])).toBe("");
  });

  it("รองรับ SaleProp ตัวใหญ่ (กัน casing แกว่งจาก Lazada)", () => {
    const skus = [{ SaleProp: { color_family: "แดง" } }, { SaleProp: { color_family: "น้ำเงิน" } }];
    expect(extractVariantOptions(skus)).toBe("แดง/น้ำเงิน");
  });

  it("หลาย prop (สี+ไซส์) → แยกกลุ่มด้วย ·", () => {
    const skus = [
      { saleProp: { color_family: "ดำ", size: "S" } },
      { saleProp: { color_family: "ขาว", size: "M" } },
    ];
    expect(extractVariantOptions(skus)).toBe("ดำ/ขาว · S/M");
  });

  it("ตัวเลือกเกิน 8 → ตัดพร้อมบอกจำนวนที่เหลือ (กัน token บวม)", () => {
    const skus = Array.from({ length: 11 }, (_, i) => ({ saleProp: { color_family: `ลาย${i + 1}` } }));
    const out = extractVariantOptions(skus);
    expect(out).toContain("ลาย1/ลาย2");
    expect(out).toContain("+อีก 3 แบบ");
  });

  it("ค่าว่าง/null ใน prop → ข้าม", () => {
    const skus = [{ saleProp: { color_family: "" } }, { saleProp: { color_family: null } }];
    expect(extractVariantOptions(skus)).toBe("");
  });

  it("ราคาต่างกันระหว่างตัวเลือก → ระบุราคาต่อตัวเลือก", () => {
    const skus = [
      { saleProp: { color_family: "สีส้ม" }, price: "499.00" },
      { saleProp: { color_family: "สีเขียว" }, price: 520 },
    ];
    expect(extractVariantOptions(skus)).toBe("สีส้ม 499 บาท/สีเขียว 520 บาท");
  });

  it("ราคาเท่ากันทุกตัวเลือก → ไม่ต้องซ้ำราคา (จัดกลุ่มแบบเดิม)", () => {
    const skus = [
      { saleProp: { color_family: "สีส้ม" }, price: "499.00" },
      { saleProp: { color_family: "สีเขียว" }, price: "499" },
    ];
    expect(extractVariantOptions(skus)).toBe("สีส้ม/สีเขียว");
  });

  it("บาง SKU ไม่มีราคา → ไม่กล้าระบุราคา ใช้จัดกลุ่มแบบเดิม", () => {
    const skus = [
      { saleProp: { color_family: "สีส้ม" }, price: "499" },
      { saleProp: { color_family: "สีเขียว" } },
    ];
    expect(extractVariantOptions(skus)).toBe("สีส้ม/สีเขียว");
  });

  it("หลาย prop + ราคาต่าง → ตัวเลือกผสมพร้อมราคา", () => {
    const skus = [
      { saleProp: { color_family: "ดำ", size: "S" }, price: "100" },
      { saleProp: { color_family: "ดำ", size: "M" }, price: "120" },
    ];
    expect(extractVariantOptions(skus)).toBe("ดำ+S 100 บาท/ดำ+M 120 บาท");
  });
});

describe("withVariantNote", () => {
  it("ต่อท้าย description ด้วย ·", () => {
    expect(withVariantNote("ถ่านลิเธียม 1.5V", "สีส้ม/สีเขียว")).toBe(
      "ถ่านลิเธียม 1.5V · มีให้เลือก: สีส้ม/สีเขียว",
    );
  });

  it("description ว่าง → เหลือแค่ตัวเลือก", () => {
    expect(withVariantNote("", "สีส้ม/สีเขียว")).toBe("มีให้เลือก: สีส้ม/สีเขียว");
  });

  it("ไม่มีตัวเลือก → คืน description เดิม", () => {
    expect(withVariantNote("ถ่านลิเธียม", undefined)).toBe("ถ่านลิเธียม");
    expect(withVariantNote("ถ่านลิเธียม", "")).toBe("ถ่านลิเธียม");
  });

  it("มี note เดิมอยู่แล้ว → ไม่ต่อซ้ำ (กัน sync/import วนหลายรอบ)", () => {
    const once = withVariantNote("ถ่านลิเธียม", "สีส้ม/สีเขียว");
    expect(withVariantNote(once, "สีส้ม/สีเขียว")).toBe(once);
  });
});

describe("replaceVariantNote (sync รีเฟรช note)", () => {
  it("ยังไม่มี note → ต่อท้ายให้", () => {
    expect(replaceVariantNote("ถ่านลิเธียม", "สีส้ม/สีเขียว")).toBe(
      "ถ่านลิเธียม · มีให้เลือก: สีส้ม/สีเขียว",
    );
  });

  it("note เก่าราคาเปลี่ยน → แทนที่ด้วยของใหม่", () => {
    const old = "ถ่านลิเธียม · มีให้เลือก: สีส้ม 499 บาท/สีเขียว 520 บาท";
    expect(replaceVariantNote(old, "สีส้ม 499 บาท/สีเขียว 479 บาท")).toBe(
      "ถ่านลิเธียม · มีให้เลือก: สีส้ม 499 บาท/สีเขียว 479 บาท",
    );
  });

  it("note เดิมตรงอยู่แล้ว → ได้ค่าเดิมเป๊ะ (sync 45 วิ ไม่เขียนซ้ำฟรี)", () => {
    const cur = "ถ่านลิเธียม · มีให้เลือก: สีส้ม/สีเขียว";
    expect(replaceVariantNote(cur, "สีส้ม/สีเขียว")).toBe(cur);
  });

  it("variantOptions ว่าง → ไม่แตะ description เดิม (กันลบข้อความที่ร้านเขียนเอง)", () => {
    const cur = "ถ่านลิเธียม · มีให้เลือก: สีส้ม/สีเขียว";
    expect(replaceVariantNote(cur, undefined)).toBe(cur);
    expect(replaceVariantNote(cur, "")).toBe(cur);
  });

  it("description มีแต่ note ล้วน → แทนที่ทั้งก้อน", () => {
    expect(replaceVariantNote("มีให้เลือก: สีส้ม/สีเขียว", "สีดำ/สีขาว")).toBe(
      "มีให้เลือก: สีดำ/สีขาว",
    );
  });
});
