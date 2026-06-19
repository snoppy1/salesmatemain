export type Shop = {
  name: string;
  voice: string;
};

export type Admin = {
  id: string;
  shopId: string;
  username: string;
};

export type Product = {
  id: string;
  name: string; // ชื่อสินค้า
  description: string; // คำอธิบายสินค้า
  price: string; // ราคา (ว่างได้)
};

/** ข้อมูลร้าน + คู่พ่วง + คลังสินค้า ที่โหลด/บันทึกพร้อมกัน */
export type ShopData = {
  shop: Shop;
  rules: Rule[];
  products: Product[];
};

/** สรุปร้านในมุมมอง superadmin (ลิสต์เลือกร้าน) */
export type ShopSummary = {
  id: string;
  name: string;
  username: string;
  ruleCount: number;
  createdAt: number;
};

export type Rule = {
  id: string;
  trigger: string; // ลูกค้าสนใจสินค้าอะไร
  partner: string; // เสนอพ่วงตัวไหน
  price: string; // ราคาตัวที่เสนอพ่วง
  reason: string; // ทำไมขายคู่กัน (ดีกับลูกค้ายังไง)
  promo: string; // โปร (ว่างได้)
};

export type GenerateRequest = {
  shopName: string;
  shopVoice: string;
  rules: Rule[];
  products: Product[];
  customerMsg: string; // ข้อความ + บริบทจากลูกค้า รวมในช่องเดียว
};

export type GenerateResult = {
  should_upsell: boolean;
  message: string;
  reason_for_admin: string;
  est_added_value: number | null;
};
