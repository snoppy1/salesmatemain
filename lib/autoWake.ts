/**
 * เงื่อนไขปลุก AI ตอบข้อความที่ "กู้มาจาก poll" (Lazada push หล่น — 8 ส.ค. ลูกค้าเคยรอ 3.5 ชม.)
 * แยกเป็นฟังก์ชันล้วนไม่มี import เพื่อ unit test ได้โดยไม่แตะ DB/API
 */
export const POLL_WAKE_MAX_AGE_MS = 40 * 60 * 1000; // เฉพาะข้อความใหม่ ~1 รอบ cron กว่าๆ — กันไปขุดตอบแชตเก่าตอน backfill ยาว

export function shouldWakePolledReply(
  last: { sender: string; text: string; createdAt: number } | null,
  mode: "manual" | "auto" | null,
  now: number,
): boolean {
  if (!last || last.sender !== "customer") return false; // มีฝั่งร้าน (คน/greeting) ตอบแล้ว — ไม่แทรก
  if (!last.text.trim()) return false; // รูปล้วน — webhook ก็ไม่ auto-reply รูป (กติกาเดิม ให้คนดู)
  if (now - last.createdAt > POLL_WAKE_MAX_AGE_MS) return false;
  return mode === "auto";
}
