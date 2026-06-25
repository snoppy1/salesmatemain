import { describe, it, expect } from "vitest";
import { parseReplyResult } from "@/lib/claude";

describe("parseReplyResult", () => {
  it("maps all fields incl. upsell", () => {
    const r = parseReplyResult({
      message: "x", needs_human: false, reason_for_admin: "r",
      should_upsell: true, est_added_value: 120, upsell_product: "เคส",
    });
    expect(r).toEqual({
      message: "x", needsHuman: false, reason: "r",
      shouldUpsell: true, estAddedValue: 120, upsellProduct: "เคส",
    });
  });
  it("defaults missing fields", () => {
    expect(parseReplyResult({})).toEqual({
      message: "", needsHuman: false, reason: "",
      shouldUpsell: false, estAddedValue: null, upsellProduct: "",
    });
  });
  it("treats non-number est_added_value as null", () => {
    expect(parseReplyResult({ est_added_value: "abc" }).estAddedValue).toBeNull();
  });
});
