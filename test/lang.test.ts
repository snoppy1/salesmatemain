import { describe, it, expect } from "vitest";
import { isMostlyEnglish } from "@/lib/lang";

describe("isMostlyEnglish — กันแชตอังกฤษเข้าสู่ AI (ยังไม่รองรับ)", () => {
  it("อังกฤษเต็มประโยค → true", () => {
    expect(isMostlyEnglish("I need this 3.7V and 11.477wh label")).toBe(true);
    expect(isMostlyEnglish("Do you ship to Singapore?")).toBe(true);
    expect(isMostlyEnglish("hello")).toBe(true); // ทักเดี่ยวๆ แบบฝรั่ง → รอตอบ (ปลอดภัยไว้ก่อน)
  });

  it("ไทย/ไทยปนอังกฤษ → false (AI ตอบได้)", () => {
    expect(isMostlyEnglish("แบต LiFePO4 48V ราคาเท่าไหร่ครับ")).toBe(false);
    expect(isMostlyEnglish("มี GPS ไหมครับ")).toBe(false);
    expect(isMostlyEnglish("สวัสดีครับ")).toBe(false);
  });

  it("คำสั้น/รหัสรุ่น/ลิงก์/ตัวเลข → false", () => {
    expect(isMostlyEnglish("ok")).toBe(false);
    expect(isMostlyEnglish("18650")).toBe(false);
    expect(isMostlyEnglish("https://www.lazada.co.th/products/abc-i123.html")).toBe(false);
    expect(isMostlyEnglish("")).toBe(false);
  });
});
