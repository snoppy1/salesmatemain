import "server-only";
import { listUnsoldUpsells, markUpsellSold, listUnmatchedCardSends, recordAssistMatch } from "./upsellRepo";
import { recentOrdersWithItems } from "./lazadaOrders";
import { matchUpsellProduct } from "./upsellMatch";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // เหตุการณ์พ่วงมีอายุแมตช์ 7 วัน
const ORDER_FETCH_MS = 48 * 60 * 60 * 1000; // ดึงออเดอร์ย้อนหลังแค่ 2 วันต่อรอบ (ออเดอร์เก่ากว่านั้นถูกเช็คไปหลายรอบแล้ว)
const SLACK_MS = 10 * 60 * 1000; // เผื่อเวลาเหลื่อม: ลูกค้ากดสั่งระหว่างที่ AI กำลังเสนอ

/**
 * แมตช์พ่วงกับออเดอร์แบบ "สินค้า + เวลา": AI เสนอสินค้า X ไป แล้วร้านมีออเดอร์สินค้า X
 * เกิดขึ้นหลังจากนั้น (ภายใน 7 วัน) → นับว่าปิดได้
 * — Lazada ไม่บอกว่าออเดอร์เป็นของลูกค้าคนไหน (ชื่อ mask, ไม่มี buyer filter) จึงยืนยันรายคนไม่ได้
 *   ตัวเลขนี้เป็น "ประมาณการ" ที่วัดแนวโน้มได้จริง; 1 รายการที่ซื้อ นับให้เหตุการณ์เดียว ไม่นับเบิ้ล
 * คืนจำนวนที่เพิ่งแมตช์ได้ใหม่ — best-effort, ข้ามตัวที่พลาด
 */
export async function attributeUpsells(shopId: string, token: string): Promise<number> {
  const since = Date.now() - WINDOW_MS;
  const events = (await listUnsoldUpsells(shopId, since)).filter((e) => e.channel === "lazada");
  const cards = await listUnmatchedCardSends(shopId, since);
  if (!events.length && !cards.length) return 0;

  const earliest = Math.min(
    ...events.map((e) => e.createdAt),
    ...cards.map((c) => c.createdAt),
  );
  const fetchSince = Math.max(earliest - SLACK_MS, Date.now() - ORDER_FETCH_MS);
  const orders = await recentOrdersWithItems(token, fetchSince);
  if (!orders.length) return 0;

  const used = new Set<string>(); // "orderId|ชื่อรายการ" ที่แมตช์ไปแล้ว — กัน 1 รายการซื้อถูกนับหลายเหตุการณ์
  let matched = 0;
  for (const e of events) {
    for (const o of orders) {
      if (o.createdAt == null || o.createdAt < e.createdAt - SLACK_MS) continue; // ออเดอร์เกิดก่อนเสนอ → ไม่ใช่ผลของ AI
      const fresh = o.items.filter((it) => !used.has(`${o.orderId}|${it.name}`));
      const hit = matchUpsellProduct(e.product, fresh);
      if (hit) {
        try {
          await markUpsellSold(e.id, hit.price, o.orderId);
          used.add(`${o.orderId}|${hit.name}`);
          matched++;
        } catch (err) {
          console.error("[upsell] markUpsellSold ล้ม:", err instanceof Error ? err.message : err);
        }
        break;
      }
    }
  }

  // "AI มีส่วนช่วย": สินค้าบนการ์ดที่ส่ง → มีออเดอร์สินค้านั้นเกิดหลังส่ง (ฐานกว้างกว่าพ่วง —
  // นับทุกการแนะนำ ไม่ใช่แค่ชวนซื้อเพิ่ม; กันซ้ำด้วย UNIQUE ใน assist_matches ไม่ใช้ used ร่วมกับพ่วง)
  for (const c of cards) {
    for (const o of orders) {
      if (o.createdAt == null || o.createdAt < c.createdAt - SLACK_MS) continue;
      const hit = matchUpsellProduct(c.product, o.items);
      if (hit) {
        try {
          await recordAssistMatch({
            shopId,
            messageId: c.messageId,
            product: c.product,
            itemName: hit.name,
            orderId: o.orderId,
            soldValue: hit.price,
            cardAt: c.createdAt,
          });
        } catch (err) {
          console.error("[upsell] recordAssistMatch ล้ม:", err instanceof Error ? err.message : err);
        }
        break; // การ์ดใบนี้แมตช์แล้ว — ใบต่อไป
      }
    }
  }
  return matched;
}
