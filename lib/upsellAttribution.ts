import "server-only";
import { listUnsoldUpsells, markUpsellSold } from "./upsellRepo";
import { getSendTarget } from "./inboxRepo";
import { getOrdersByBuyer } from "./lazadaOrders";
import { matchUpsellProduct } from "./upsellMatch";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // กรอบแมตช์ 7 วัน

/**
 * แมตช์พ่วงที่ส่งไปกับออเดอร์จริงของลูกค้ารายนั้น (เฉพาะแชต Lazada ที่รู้ buyer)
 * คืนจำนวนเหตุการณ์ที่เพิ่งแมตช์ได้ใหม่ — best-effort, ข้ามตัวที่พลาด
 */
export async function attributeUpsells(shopId: string, token: string): Promise<number> {
  const since = Date.now() - WINDOW_MS;
  const events = await listUnsoldUpsells(shopId, since);
  let matched = 0;
  for (const e of events) {
    if (e.channel !== "lazada") continue; // จับคู่ได้เฉพาะที่รู้ buyer
    try {
      const target = await getSendTarget(shopId, e.conversationId);
      const buyerId = target?.lineUserId;
      if (!buyerId) continue;
      const orders = await getOrdersByBuyer(token, buyerId);
      for (const o of orders) {
        const hit = matchUpsellProduct(e.product, o.items);
        if (hit) {
          await markUpsellSold(e.id, hit.price, o.orderId);
          matched++;
          break;
        }
      }
    } catch {
      // ข้ามเหตุการณ์ที่พลาด ไม่ให้ทั้ง job ล้ม
    }
  }
  return matched;
}
