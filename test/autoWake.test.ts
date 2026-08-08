import { describe, it, expect } from "vitest";
import { shouldWakePolledReply, POLL_WAKE_MAX_AGE_MS } from "@/lib/autoWake";

const NOW = 1_700_000_000_000;
const fresh = { sender: "customer", text: "ส่งไปแล้วครับผม", createdAt: NOW - 8 * 60_000 };

describe("shouldWakePolledReply (ปลุก AI ตอบข้อความที่ poll กู้มา)", () => {
  it("ลูกค้าทัก + ใหม่ + โหมด auto → ปลุก", () => {
    expect(shouldWakePolledReply(fresh, "auto", NOW)).toBe(true);
  });

  it("ข้อความล่าสุดเป็นฝั่งร้าน (คน/greeting ตอบแล้ว) → ไม่แทรก", () => {
    expect(shouldWakePolledReply({ ...fresh, sender: "admin" }, "auto", NOW)).toBe(false);
  });

  it("รูปล้วน (text ว่าง) → ไม่ปลุก ตามกติกา webhook เดิม", () => {
    expect(shouldWakePolledReply({ ...fresh, text: "  " }, "auto", NOW)).toBe(false);
  });

  it("ข้อความเก่าเกิน 40 นาที → ไม่ปลุก (กันขุดตอบแชตเก่าตอน backfill)", () => {
    const old = { ...fresh, createdAt: NOW - POLL_WAKE_MAX_AGE_MS - 1 };
    expect(shouldWakePolledReply(old, "auto", NOW)).toBe(false);
    // ขอบพอดี 40 นาที → ยังปลุก
    const edge = { ...fresh, createdAt: NOW - POLL_WAKE_MAX_AGE_MS };
    expect(shouldWakePolledReply(edge, "auto", NOW)).toBe(true);
  });

  it("โหมด manual หรือหาบทสนทนาไม่เจอ → ไม่ปลุก", () => {
    expect(shouldWakePolledReply(fresh, "manual", NOW)).toBe(false);
    expect(shouldWakePolledReply(fresh, null, NOW)).toBe(false);
  });

  it("ไม่มีข้อความเลย → ไม่ปลุก", () => {
    expect(shouldWakePolledReply(null, "auto", NOW)).toBe(false);
  });
});
