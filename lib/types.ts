export type Shop = {
  name: string;
  voice: string;
  /** ข้อมูล/นโยบายร้านที่อยากให้ AI จำไว้ตอบลูกค้าได้เอง (ค่าส่ง/จ่ายเงิน/รับประกัน/เวลาทำการ ฯลฯ) */
  memory: string;
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
  image?: string; // รูปสินค้า (data URL ที่อัปโหลด หรือ URL จาก marketplace) — ว่างได้
  source?: string; // ที่มา — รายชื่อ platform คั่นด้วย , เช่น "lazada" หรือ "lazada,shopee" (ว่าง = เพิ่มเอง)
  externalId?: string; // รหัสสินค้าฝั่ง marketplace
  enabled?: boolean; // เปิดขายอยู่ไหม (false = หมดสต็อก, AI จะไม่เอาไปคิด)
  stock?: number; // จำนวนคงเหลือ (รวม/ที่ใช้ตอบลูกค้า) — ว่าง = ไม่ระบุ
  stockByPlatform?: Record<string, number>; // จำนวนคงเหลือแยกรายแพลตฟอร์ม เช่น { lazada: 12, shopee: 8 }
  embedding?: number[]; // เวกเตอร์ความหมาย (Voyage) ใช้ทำ hybrid retrieval — โหลดเฉพาะตอนตอบแชต
};

/** โปรโมชั่นระดับร้าน (sync มาจาก Lazada หรือพิมพ์เอง) ที่ AI ใช้แนะนำลูกค้า */
export type Promotion = {
  id: string;
  title: string;            // ชื่อโปร เช่น "ซื้อ 2 ลด 50"
  type: string;             // percent | fixed | code | bundle | ...
  conditionsText: string;   // เงื่อนไขแบบอ่านรู้เรื่องให้ AI
  minSpend: number | null;  // ยอดขั้นต่ำ (บาท) — null = ไม่มี
  productScope: string;     // "" = ทุกชิ้น; ไม่ว่าง = ชื่อ/คีย์เวิร์ดสินค้าที่ใช้ได้
  code: string;             // โค้ดส่วนลด ("" ถ้าไม่มี)
  startsAt: number | null;  // epoch ms; null = ไม่จำกัดเริ่ม
  endsAt: number | null;    // epoch ms; null = ไม่จำกัดสิ้นสุด
  source: string;           // "lazada" | "manual"
};

/**
 * ตั้งค่า "ข้อมูลทดลอง (mock)" แยกต่อแพลตฟอร์ม — 2 หมวด: แชต / สินค้า
 * คีย์ = channel/platform (line/facebook/tiktok/lazada/shopee)
 * ไม่มีคีย์ = ค่าเริ่มต้นเปิดทั้งคู่ (ช่วงทดลอง)
 */
export type MockToggle = { chat: boolean; catalog: boolean };
export type MockSettings = Record<string, MockToggle>;

/**
 * ระดับการตอบของ AI ต่อร้าน
 * - off  = ปิด (AI ร่างให้ คนกดส่งเอง)
 * - safe = ปลอดภัย (ตอบเองเฉพาะที่มั่นใจ, ไม่มั่นใจ → รอตอบ)
 * - full = Full auto (ตอบทุกข้อความ)
 */
export type AutoLevel = "off" | "safe" | "full";

/** สถานะการเชื่อมต่อ marketplace ของร้าน */
export type ConnectionStatus = {
  connected: boolean;
  platform: string;
  sellerId?: string;
  expiresAt?: number;
  mock?: boolean;
};

/** ข้อมูลร้าน + คลังสินค้า ที่โหลด/บันทึกพร้อมกัน (rules = ระบบพ่วงเดิม เลิกใช้แล้ว) */
export type ShopData = {
  shop: Shop;
  rules?: Rule[];
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
  shopMemory: string; // ข้อมูล/นโยบายร้านที่ร้านอยากให้ AI จำ (ดู Shop.memory)
  products: Product[];
  promotions?: Promotion[]; // โปรโมชั่นที่ใช้ได้ตอนนี้ (กรองแล้ว) ให้ AI แนะนำ
  customerMsg: string; // ข้อความ + บริบทจากลูกค้า รวมในช่องเดียว
  imageUrls?: string[]; // ลิงก์รูปจากลูกค้า (ส่งเข้า Claude ให้ดูภาพ) — มีเฉพาะตอนแชตมีรูป
  queryEmbedding?: number[]; // เวกเตอร์ของคำถามลูกค้า (Voyage) ใช้ทำ hybrid retrieval — เซ็ตตอนตอบแชต
};

/** ผลลัพธ์การแยกข้อมูลอัตโนมัติจากข้อความดิบ (ยังไม่มี id) */
export type ImportResult = {
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
  kind: "text" | "image";
  imageUrl?: string;
  blobKey?: string;
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

/** สถานะการเชื่อมเพจ Facebook ของร้าน */
export type FacebookChannelStatus = {
  connected: boolean;
  pageName?: string;
  pageId?: string;
  webhookUrl?: string;
  verifyToken?: string; // สำหรับตั้งค่า webhook ใน Meta (ระดับแอป)
  configured?: boolean; // ตั้ง env App Secret + Verify Token แล้วหรือยัง
  mock?: boolean;
};

/** สถานะการเชื่อมบัญชีแชต TikTok ของร้าน */
export type TiktokChannelStatus = {
  connected: boolean;
  accountName?: string;
  accountId?: string;
  webhookUrl?: string;
  configured?: boolean; // ตั้ง env TIKTOK_CHAT_SECRET แล้วหรือยัง
  mock?: boolean;
};

/** สถานะการเชื่อมบัญชีแชต Lazada ของร้าน */
export type LazadaChannelStatus = {
  connected: boolean;
  accountName?: string;
  accountId?: string;
  webhookUrl?: string;
  configured?: boolean; // ตั้ง env LAZADA_CHAT_SECRET แล้วหรือยัง
  mock?: boolean;
  expired?: boolean; // token หมดอายุแล้ว (แชตใหม่ไม่เข้า) — ต้องกดเชื่อมใหม่
};

/** สถานะการเชื่อมบัญชีแชต Shopee ของร้าน */
export type ShopeeChannelStatus = {
  connected: boolean;
  accountName?: string;
  accountId?: string;
  webhookUrl?: string;
  configured?: boolean; // ตั้ง env SHOPEE_PARTNER_ID/KEY แล้วหรือยัง
  mock?: boolean;
};
