import { describe, it, expect } from "vitest";
import { pickMentionedLazadaProducts, resolveUpsellProductName } from "@/lib/productCards";
import type { Product } from "@/lib/types";

function prod(id: string, name: string, stock = 10, over: Partial<Product> = {}): Product {
  return {
    id, name, description: "", price: "100",
    source: "lazada", externalId: `ext-${id}`, stock,
    ...over,
  };
}

const CATALOG: Product[] = [
  prod("s12", "✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-S12 เครื่องชาร์จถ่าน ราง 12 ช่อง สำหรับ ถ่าน18650"),
  prod("s8", "✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-S8 เครื่องชาร์จถ่าน ราง 8 ช่อง สำหรับ ถ่าน18650"),
  prod("bat48", "แบตเตอรี่สามล้อไฟฟ้า 48V20AH แอมป์แท้ ทนจริง Lifepo4 BMS30A"),
  prod("bms8s", "วงจร BMS 8S(24V) 25A สำหรับแบตเตอรี่ Lifepo4 3.2V", 0), // ของหมด
  prod("manual", "สินค้ากรอกมือ ไม่มี externalId", 10, { source: "", externalId: "" }),
];

describe("pickMentionedLazadaProducts: ส่งการ์ดเฉพาะที่ AI เอ่ยถึงจริง", () => {
  it("เอ่ยโค้ดรุ่นชัดๆ (Lii-S12) → ได้การ์ดตัวนั้นตัวเดียว", () => {
    const picked = pickMentionedLazadaProducts(
      "มีค่ะ Liitokala Lii-S12 ราง 12 ช่อง ราคา 1,250 บาทค่ะ", "", CATALOG,
    );
    expect(picked.map((p) => p.id)).toEqual(["s12"]);
  });

  it("เอ่ยสเปกคู่ (48V 20Ah) แบบเว้นวรรค → จับกับชื่อที่เขียนติดกัน (48V20AH) ได้", () => {
    const picked = pickMentionedLazadaProducts(
      "แบตสามล้อ 48V 20Ah มีของพร้อมส่งค่ะ ราคา 5,500 บาท", "", CATALOG,
    );
    expect(picked.map((p) => p.id)).toContain("bat48");
  });

  it("ข้อความทั่วไป/คำถามลอยๆ → ไม่ส่งการ์ดเลย (กันการ์ดผิดตัว)", () => {
    expect(pickMentionedLazadaProducts("สวัสดีค่ะ สอบถามได้เลยนะคะ", "", CATALOG)).toEqual([]);
    expect(pickMentionedLazadaProducts("มีแบตเตอรี่ lifepo4 หลายรุ่นเลยค่ะ สนใจกี่โวลต์คะ", "", CATALOG)).toEqual([]);
  });

  it("ของหมดถูกเอ่ยถึง → ไม่ส่งการ์ดของหมด", () => {
    const picked = pickMentionedLazadaProducts(
      "BMS 8S(24V) 25A ราคา 195 บาทค่ะ แต่ของหมดชั่วคราว", "", CATALOG,
    );
    expect(picked.map((p) => p.id)).not.toContain("bms8s");
  });

  it("สินค้าที่ไม่ใช่ Lazada/ไม่มี externalId → ไม่มีการ์ด", () => {
    const picked = pickMentionedLazadaProducts("สินค้ากรอกมือ ไม่มี externalId มีค่ะ", "", CATALOG);
    expect(picked.map((p) => p.id)).not.toContain("manual");
  });

  it("upsell_product ชื่อตรงกับคลัง → ได้การ์ดตัวพ่วง", () => {
    const picked = pickMentionedLazadaProducts(
      "รับเครื่องชาร์จเพิ่มไหมคะ", "Liitokala Lii-S8 เครื่องชาร์จถ่าน ราง 8 ช่อง", CATALOG,
    );
    expect(picked.map((p) => p.id)).toEqual(["s8"]);
  });

  it("resolveUpsellProductName: AI พูดชื่อฉบับย่อ → ได้ชื่อเต็มจริงกลับ (ให้ตัวแมตช์ออเดอร์ใช้)", () => {
    const products: Product[] = [
      {
        id: "x",
        name: "✅ รับประกันศูนย์1ปี ✅ Liitokala Lii-S8 เครื่องชาร์จถ่าน ราง 8 ช่อง สำหรับ ถ่าน18650",
        aiName: "Liitokala Lii-S8 เครื่องชาร์จถ่าน 8 ช่อง",
        description: "", price: "1199", stock: 5,
      },
    ];
    expect(resolveUpsellProductName(products, "Liitokala Lii-S8 เครื่องชาร์จถ่าน 8 ช่อง"))
      .toBe(products[0].name);
    // ไม่รู้จัก → คืนค่าเดิม
    expect(resolveUpsellProductName(products, "สินค้าปริศนา")).toBe("สินค้าปริศนา");
  });

  it("การ์ด: จับคู่จากโค้ดรุ่นใน aiName ได้ แม้ reply ใช้ชื่อย่อ", () => {
    const products: Product[] = [
      {
        id: "y",
        name: "เครื่องชาร์จถ่านคุณภาพสูงของแท้ประกันศูนย์ไทย รุ่นใหม่ล่าสุด",
        aiName: "XTAR VC4SL เครื่องชาร์จถ่าน 4 ช่อง",
        description: "", price: "935", stock: 3, source: "lazada", externalId: "ext-y",
      },
    ];
    const picked = pickMentionedLazadaProducts("แนะนำ XTAR VC4SL ค่ะ ราคา 935 บาท", "", products);
    expect(picked.map((p) => p.id)).toEqual(["y"]);
  });

  it("เอ่ยหลายตัว → ไม่เกิน 2 การ์ด", () => {
    const picked = pickMentionedLazadaProducts(
      "มี Lii-S12 1,250 บาท กับ Lii-S8 1,199 บาท และแบต 48V 20Ah 5,500 บาทค่ะ", "", CATALOG,
    );
    expect(picked.length).toBeLessThanOrEqual(2);
  });
});
