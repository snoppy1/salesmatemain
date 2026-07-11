import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContentParts, REPLY_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * เครื่องมือวัดขนาด prompt จริงของร้าน (เทียบกับ cache_write ที่ prod บันทึก)
 * รัน: SIZECHECK=1 SNAPSHOT_PATH=<snapshot.json> npx vitest run test/sizecheck-gate.test.ts
 * นับ token เป๊ะผ่าน count_tokens API (ฟรี ไม่เสียเครดิต)
 */

const RUN = process.env.SIZECHECK === "1";

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

async function countTokens(system: string, stable: string, promo: string, customer: string): Promise<number> {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      system: [{ type: "text", text: system }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: stable },
            { type: "text", text: promo },
            { type: "text", text: `\n\n${customer}` },
          ],
        },
      ],
    }),
  });
  const data = (await res.json()) as { input_tokens?: number };
  return data.input_tokens ?? -1;
}

describe.runIf(RUN)("sizecheck", () => {
  it("วัดขนาด prompt ปัจจุบันของร้านจาก snapshot", async () => {
    loadEnv();
    const snap = JSON.parse(readFileSync(process.env.SNAPSHOT_PATH as string, "utf8")) as {
      shopName: string; shopVoice: string; shopMemory: string;
      products: (Omit<Product, "id"> & { id?: string })[];
    };
    const products: Product[] = snap.products.map((p, i) => ({ ...p, id: p.id ?? String(i) })) as Product[];
    const enabled = products.filter((p) => p.enabled !== false && p.name.trim());
    const soldOut = enabled.filter((p) => typeof p.stock === "number" && p.stock <= 0);
    const stockTypes = new Map<string, number>();
    for (const p of enabled) {
      const k = p.stock === undefined ? "undefined" : typeof p.stock;
      stockTypes.set(k, (stockTypes.get(k) ?? 0) + 1);
    }

    const parts = buildUserContentParts({
      shopName: snap.shopName, shopVoice: snap.shopVoice, shopMemory: snap.shopMemory,
      products, customerMsg: "สวัสดีครับ", promotions: [],
    });
    const tok = await countTokens(REPLY_SYSTEM_PROMPT, parts.stable, parts.promo, "สวัสดีครับ");
    const lines = [
      `ร้าน: ${snap.shopName}`,
      `enabled ${enabled.length} | soldOut(ตาม isSoldOut) ${soldOut.length} | ชนิด stock: ${JSON.stringify([...stockTypes])}`,
      `stable ${parts.stable.length.toLocaleString()} ตัวอักษร | มีส่วนของหมด: ${parts.stable.includes("สินค้าที่ของหมดชั่วคราว")}`,
      `token รวม (system+stable+promo+ข้อความสั้น): ${tok.toLocaleString()} | prod เขียนจริงล่าสุด: 30,326`,
    ];
    writeFileSync(process.env.SIZECHECK_OUT || "sizecheck-out.txt", lines.join("\n"));
  }, 120_000);
});
