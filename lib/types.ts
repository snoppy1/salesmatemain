export type Shop = {
  name: string;
  voice: string;
};

export type Admin = {
  id: string;
  shopId: string;
  username: string;
};

/** ข้อมูลร้าน + คู่พ่วง ที่โหลด/บันทึกพร้อมกัน */
export type ShopData = {
  shop: Shop;
  rules: Rule[];
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
  customerMsg: string; // ข้อความ + บริบทจากลูกค้า รวมในช่องเดียว
};

export type GenerateResult = {
  should_upsell: boolean;
  message: string;
  reason_for_admin: string;
  est_added_value: number | null;
};
