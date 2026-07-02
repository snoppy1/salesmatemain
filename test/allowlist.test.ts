import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeEmail,
  isEmailAllowed,
  addAllowedEmail,
  removeAllowedEmail,
  listAllowedEmails,
} from "@/lib/allowlistRepo";

// โหลด DATABASE_URL ก่อนคิวรีแรก (pool สร้าง lazy)
const env = readFileSync(".env.local", "utf8");
for (const l of env.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

// อีเมล throwaway — ลบทิ้งเองทั้งก่อนและหลัง (no-destructive-tests)
const E1 = "zz-test-allow-1@example.com";
const E2_UPPER = "ZZ-Test-Allow-2@Example.COM";
const E2_LOWER = "zz-test-allow-2@example.com";

async function cleanup() {
  await removeAllowedEmail(E1);
  await removeAllowedEmail(E2_LOWER);
}

describe("allowlistRepo", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("normalizeEmail: trim + lowercase", () => {
    expect(normalizeEmail("  Foo@BAR.com ")).toBe("foo@bar.com");
  });

  it("อีเมลที่ไม่ได้เพิ่ม → ไม่อนุญาต", async () => {
    expect(await isEmailAllowed(E1)).toBe(false);
  });

  it("เพิ่มแล้ว → อนุญาต และเช็คแบบไม่สนตัวพิมพ์", async () => {
    await addAllowedEmail(E2_UPPER, "ร้านทดสอบ");
    expect(await isEmailAllowed(E2_LOWER)).toBe(true);
    expect(await isEmailAllowed("zz-TEST-allow-2@EXAMPLE.com")).toBe(true);
  });

  it("เพิ่มซ้ำ = upsert อัปเดต note ไม่ error", async () => {
    await addAllowedEmail(E2_LOWER, "โน้ตใหม่");
    const rows = await listAllowedEmails();
    const row = rows.find((r) => r.email === E2_LOWER);
    expect(row?.note).toBe("โน้ตใหม่");
    expect(row?.registered).toBe(false); // ไม่มีบัญชีจริงของอีเมลนี้
  });

  it("ลบแล้ว → ไม่อนุญาต", async () => {
    await removeAllowedEmail(E2_LOWER);
    expect(await isEmailAllowed(E2_LOWER)).toBe(false);
  });
}, 30000);
