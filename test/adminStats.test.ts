import { describe, it, expect } from "vitest";
import { bangkokDayStartMs, THB_PER_CUSTOMER_MSG } from "@/lib/adminStats";

describe("bangkokDayStartMs", () => {
  it("10:00 เวลาไทย → เที่ยงคืนไทยวันเดียวกัน (17:00Z ของเมื่อวาน)", () => {
    const now = Date.parse("2026-07-02T03:00:00Z"); // = 10:00 ICT 2026-07-02
    expect(bangkokDayStartMs(now)).toBe(Date.parse("2026-07-01T17:00:00Z"));
  });
  it("00:30 เวลาไทย → ยังเป็นวันเดียวกัน (ไม่ถอยไปวันก่อน)", () => {
    const now = Date.parse("2026-07-01T17:30:00Z"); // = 00:30 ICT 2026-07-02
    expect(bangkokDayStartMs(now)).toBe(Date.parse("2026-07-01T17:00:00Z"));
  });
  it("ค่าคงที่ต้นทุนต่อข้อความ = 0.5", () => {
    expect(THB_PER_CUSTOMER_MSG).toBe(0.5);
  });
});
