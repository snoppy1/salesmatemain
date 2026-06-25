import { describe, it, expect } from "vitest";
import { isOrderTopic, needsHumanForOrderTopic, extractOrderId } from "@/lib/orderIntent";

describe("isOrderTopic", () => {
  it("detects shipping/order questions", () => {
    expect(isOrderTopic("ของส่งถึงไหนแล้วคะ")).toBe(true);
    expect(isOrderTopic("เลขพัสดุอะไรคะ")).toBe(true);
    expect(isOrderTopic("ออเดอร์ของหนูสถานะไง")).toBe(true);
  });
  it("ignores normal product chat", () => {
    expect(isOrderTopic("หูฟังราคาเท่าไหร่")).toBe(false);
  });
});

describe("needsHumanForOrderTopic", () => {
  it("escalates claims/cancel/refund", () => {
    expect(needsHumanForOrderTopic("ขอยกเลิกออเดอร์")).toBe(true);
    expect(needsHumanForOrderTopic("ขอคืนเงินด้วยค่ะ")).toBe(true);
    expect(needsHumanForOrderTopic("ของชำรุดขอเคลม")).toBe(true);
  });
  it("does not escalate plain status questions", () => {
    expect(needsHumanForOrderTopic("ของส่งถึงไหนแล้ว")).toBe(false);
  });
});

describe("extractOrderId", () => {
  it("pulls a long digit/letter run", () => {
    expect(extractOrderId("ออเดอร์ 123456789")).toBe("123456789");
    expect(extractOrderId("เลข TH12345678")).toBe("TH12345678");
  });
  it("returns null when none", () => {
    expect(extractOrderId("ของส่งยัง")).toBeNull();
  });
});
