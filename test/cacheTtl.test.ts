import { describe, it, expect } from "vitest";
import { chatCacheTtl } from "@/lib/aiPricing";
import { CHAT_OPUS, CHAT_SONNET } from "@/lib/modelRouter";

describe("chatCacheTtl (TTL ตามความคึกของร้าน)", () => {
  it("Sonnet ร้านคึก → 1h (มี prewarm ต่ออายุ)", () => {
    expect(chatCacheTtl(CHAT_SONNET, true)).toBe("1h");
  });

  it("Sonnet ร้านเงียบ → 5m (เขียน 1.25x แทน 2x — ไม่มี prewarm มาอุ่นอยู่แล้ว)", () => {
    expect(chatCacheTtl(CHAT_SONNET, false)).toBe("5m");
  });

  it("ไม่ส่ง highTraffic → ถือเป็นร้านเงียบ (ปลอดภัยฝั่งจ่ายน้อย)", () => {
    expect(chatCacheTtl(CHAT_SONNET)).toBe("5m");
  });

  it("Opus → 5m เสมอ ไม่สนความคึก", () => {
    expect(chatCacheTtl(CHAT_OPUS, true)).toBe("5m");
    expect(chatCacheTtl(CHAT_OPUS, false)).toBe("5m");
  });

  it("กติกาแถวเก่า (ก่อนมีคอลัมน์ cache_ttl) = chatCacheTtl(model, true): Sonnet 1h / Opus 5m", () => {
    expect(chatCacheTtl(CHAT_SONNET, true)).toBe("1h");
    expect(chatCacheTtl(CHAT_OPUS, true)).toBe("5m");
  });
});
