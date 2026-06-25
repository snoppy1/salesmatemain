import { describe, it, expect } from "vitest";
import { monthStart } from "@/lib/upsellRepo";

describe("monthStart (UTC+7)", () => {
  it("returns the 1st of the current month at 00:00 Thai time", () => {
    const now = Date.UTC(2026, 5, 15, 12, 0, 0); // 15 มิ.ย. 2026 12:00 UTC
    expect(monthStart(now)).toBe(Date.UTC(2026, 5, 1) - 7 * 3600_000);
  });
  it("a moment just after a Thai month start stays in the new month", () => {
    // 1 มิ.ย. 2026 01:00 +07 = 31 พ.ค. 18:00 UTC
    const now = Date.UTC(2026, 4, 31, 18, 0, 0);
    expect(monthStart(now)).toBe(Date.UTC(2026, 5, 1) - 7 * 3600_000);
  });
});
