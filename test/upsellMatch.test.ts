import { describe, it, expect } from "vitest";
import { matchUpsellProduct } from "@/lib/upsellMatch";

const items = [
  { name: "หูฟังบลูทูธ TWS", price: 590 },
  { name: "สายชาร์จ USB-C", price: 190 },
];

describe("matchUpsellProduct", () => {
  it("matches by substring (event product inside item name)", () => {
    expect(matchUpsellProduct("หูฟัง", items)).toEqual({ price: 590, name: "หูฟังบลูทูธ TWS" });
  });
  it("matches the other direction (item name inside event product)", () => {
    expect(matchUpsellProduct("สายชาร์จ USB-C ยาว 2m", items)).toEqual({ price: 190, name: "สายชาร์จ USB-C" });
  });
  it("returns null when nothing matches", () => {
    expect(matchUpsellProduct("เคสมือถือ", items)).toBeNull();
  });
  it("returns null for an empty product", () => {
    expect(matchUpsellProduct("", items)).toBeNull();
  });
});
