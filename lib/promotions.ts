import type { Promotion } from "./types";

/** โปรนี้ใช้ได้ ณ เวลา now ไหม (เช็คช่วงวันที่; null = ไม่จำกัด) */
export function isPromotionValidNow(p: Promotion, now: number): boolean {
  if (p.startsAt != null && now < p.startsAt) return false;
  if (p.endsAt != null && now > p.endsAt) return false;
  return true;
}

/** กรองเหลือเฉพาะโปรที่ใช้ได้ตอนนี้ (ที่จะป้อนให้ AI) */
export function validNowPromotions(promos: Promotion[], now: number): Promotion[] {
  return promos.filter((p) => isPromotionValidNow(p, now));
}
