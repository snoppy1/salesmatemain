import { describe, it, expect } from "vitest";
import { pickChatModel, CHAT_OPUS, CHAT_SONNET } from "@/lib/modelRouter";
import type { GenerateRequest } from "@/lib/types";

function req(customerMsg: string, imageUrls?: string[]): GenerateRequest {
  return { shopName: "ร้าน", shopVoice: "", shopMemory: "", products: [], customerMsg, imageUrls };
}

describe("pickChatModel (router)", () => {
  it("คำถามทั่วไป/สินค้า-ราคา → Sonnet", () => {
    for (const q of [
      "แบต 48V 20Ah ราคาเท่าไหร่",
      "มีถ่าน 18650 ไหมครับ",
      "BMS 4S กับ 13S ต่างกันยังไง",
      "อยากประกอบแบต 60V ต้องใช้ถ่านกี่ก้อน",
      "สวัสดีครับ",
    ]) {
      const c = pickChatModel(req(q));
      expect(c.tier, q).toBe("sonnet");
      expect(c.model).toBe(CHAT_SONNET);
    }
  });

  it("ต่อรองราคา → Opus", () => {
    expect(pickChatModel(req("ขอต่อราคาหน่อยได้ไหม ลดได้เท่าไหร่")).tier).toBe("opus");
    expect(pickChatModel(req("ตัวนี้ลดหน่อยได้ปะ")).tier).toBe("opus");
  });

  it("เคลม/คืนเงิน → Opus", () => {
    expect(pickChatModel(req("ของเสีย ขอเคลมได้ไหม")).tier).toBe("opus");
    expect(pickChatModel(req("อยากคืนเงินครับ ของไม่ตรงปก")).tier).toBe("opus");
  });

  it("ร้องเรียน/อารมณ์เสีย → Opus", () => {
    expect(pickChatModel(req("ร้านนี้โกงหรือเปล่า ไม่พอใจมาก")).tier).toBe("opus");
  });

  it("ความปลอดภัย (แบตบวม/ไฟไหม้) → Opus", () => {
    expect(pickChatModel(req("แบตผมบวม อันตรายไหม")).tier).toBe("opus");
    expect(pickChatModel(req("ชาร์จแล้วมีควันขึ้น")).tier).toBe("opus");
  });

  it("มีรูป → Opus เสมอ", () => {
    const c = pickChatModel(req("อันนี้รุ่นอะไร", ["https://x/img.jpg"]));
    expect(c.tier).toBe("opus");
    expect(c.model).toBe(CHAT_OPUS);
  });

  it("คืน reason ติดมาด้วย", () => {
    expect(pickChatModel(req("ขอต่อราคา")).reason).toBeTruthy();
    expect(pickChatModel(req("มีไหมครับ")).reason).toBeTruthy();
  });
});
