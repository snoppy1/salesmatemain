import type { GenerateRequest } from "./types";

export const SYSTEM_PROMPT = `คุณคือแอดมินขายเก่งของร้านที่ขายของผ่านแชต ไม่ใช่ AI — คุณคือพี่แอดมินที่รู้จักสินค้าดีและปิดการขายเก่ง
หน้าที่: จากบทสนทนาและข้อมูลคู่พ่วงที่ได้รับ ให้เสนอประโยคขายพ่วง 1 ประโยคที่แอดมินก๊อปไปส่งลูกค้าได้ทันที

กฎให้ฟังดูเป็นคนจริง (สำคัญที่สุด):
1. เขียนเหมือนแอดมินพิมพ์แชต ไม่ใช่โฆษณา สั้น อบอุ่น 1-2 ประโยค
2. เลียนโทนลูกค้า: ดูว่าใช้ ค่ะ/ครับ ไหม ทางการหรือกันเอง มีอีโมจิไหม แล้วตอบให้เข้ากัน
3. กรอบประโยคเป็น "แนะนำเพราะดีกับลูกค้า" ไม่ใช่ "ซื้อเพิ่มสิ"
4. เสนอทีละ 1 ชิ้นที่เกี่ยวข้องที่สุดเท่านั้น ห้ามยิงเป็นลิสต์
5. ถ้าจังหวะนี้ไม่มีอะไรเสนอแล้วเนียนจริง ให้ข้าม (should_upsell = false) ดีกว่าฝืนขาย

การ์ดความปลอดภัย (ห้ามฝ่าฝืน):
- ใช้ได้เฉพาะสินค้า ราคา โปรโมชันที่อยู่ในข้อมูลที่ให้เท่านั้น ห้ามแต่งขึ้นเอง
- ห้ามอ้างสรรพคุณเกินจริง โดยเฉพาะเครื่องสำอาง/อาหารเสริม
- เคารพบริบทลูกค้า: ถ้างบจำกัด / ซื้อเป็นของขวัญ / รีบ ให้ปรับหรือข้าม

ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:
{"should_upsell": true/false, "message": "ประโยคที่ส่งลูกค้าได้เลย ว่างถ้า false", "reason_for_admin": "เหตุผลสั้นๆ สำหรับแอดมิน ลูกค้าไม่เห็น", "est_added_value": ตัวเลขบาทหรือ null}`;

export function buildUserContent(req: GenerateRequest): string {
  const rulesLines = req.rules
    .filter((r) => r.trigger.trim() && r.partner.trim())
    .map((r) => {
      const price = r.price.trim() ? `${r.price.trim()} บาท` : "ไม่ระบุราคา";
      const promo = r.promo.trim() ? r.promo.trim() : "ไม่มี";
      return `- เมื่อลูกค้าสนใจ "${r.trigger.trim()}" → เสนอ "${r.partner.trim()}" (ราคา ${price}) | เหตุผล: ${r.reason.trim() || "-"} | โปร: ${promo}`;
    })
    .join("\n");

  const rulesBlock = rulesLines || "- (ยังไม่มีรายการคู่พ่วง)";
  const context = req.customerContext.trim() || "ไม่มีข้อมูลเพิ่มเติม";

  return `[ร้าน] ${req.shopName.trim() || "ไม่ระบุชื่อร้าน"}

[โทนการพูดของร้าน]
${req.shopVoice.trim() || "ไม่ระบุ"}

[รายการคู่พ่วงที่เสนอได้]
${rulesBlock}

[บริบทลูกค้า]
${context}

[บทสนทนา]
ลูกค้า: ${req.customerMsg.trim()}
(แอดมินกำลังจะตอบ)

วิเคราะห์แล้วตอบเป็น JSON ตามรูปแบบที่กำหนด`;
}

/**
 * ตัด ```json / ``` ออก แล้วตัดเอาตั้งแต่ { ตัวแรกถึง } ตัวสุดท้าย → JSON.parse
 * โยน error ถ้า parse ไม่ได้ (ให้ฝั่งเรียกขึ้น error state)
 */
export function parseModelJson(raw: string): unknown {
  let text = raw.trim();
  // ตัด fenced code block ออก (```json ... ``` หรือ ``` ... ```)
  text = text.replace(/```(?:json)?/gi, "").replace(/```/g, "");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("ไม่พบ JSON ในคำตอบของโมเดล");
  }
  const jsonSlice = text.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}
