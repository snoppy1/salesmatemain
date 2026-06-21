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
  source?: string; // ที่มา — รายชื่อ platform คั่นด้วย , เช่น "lazada" หรือ "lazada,shopee" (ว่าง = เพิ่มเอง)
  externalId?: string; // รหัสสินค้าฝั่ง marketplace
  enabled?: boolean; // เปิดขายอยู่ไหม (false = หมดสต็อก, AI จะไม่เอาไปคิด)
};

/** สถานะการเชื่อมต่อ marketplace ของร้าน */
export type ConnectionStatus = {
  connected: boolean;
  platform: string;
  sellerId?: string;
  expiresAt?: number;
  mock?: boolean;
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
  enabled?: boolean; // เปิดใช้อยู่ไหม (false = AI จะไม่เอาไปคิด)
};

export type GenerateRequest = {
  shopName: string;
  shopVoice: string;
  rules: Rule[];
  products: Product[];
  customerMsg: string; // ข้อความ + บริบทจากลูกค้า รวมในช่องเดียว
};

/** ผลลัพธ์การแยกข้อมูลอัตโนมัติจากข้อความดิบ (ยังไม่มี id) */
export type ImportResult = {
  rules: Omit<Rule, "id">[];
  products: Omit<Product, "id">[];
};

export type GenerateResult = {
  should_upsell: boolean;
  message: string;
  reason_for_admin: string;
  est_added_value: number | null;
};

/* ---------------- LINE inbox ---------------- */

export type ChatMessage = {
  id: string;
  sender: "customer" | "admin";
  text: string;
  createdAt: number;
};

/** สรุปบทสนทนาในลิสต์ฝั่งซ้าย */
export type ConversationSummary = {
  id: string;
  customerName: string;
  channel: string;
  lastText: string;
  lastMessageAt: number;
  lastSender: "customer" | "admin" | null;
  pendingHuman: boolean;
};

/** บทสนทนาเต็ม (เลือกดูฝั่งขวา) */
export type ConversationDetail = {
  id: string;
  customerName: string;
  channel: string;
  mode: "manual" | "auto";
  messages: ChatMessage[];
};

/** สถานะการเชื่อม LINE OA ของร้าน */
export type LineChannelStatus = {
  connected: boolean;
  displayName?: string;
  basicId?: string;
  webhookUrl?: string;
  mock?: boolean;
};
