import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContent, REPLY_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบ "ราคา+หน่วย" (feedback ลูกค้า: รวมราคา/เสนอราคาถูก 50% เพราะไม่รู้ราคาต่อกี่ชิ้น)
 * รัน: PRICE_GATE=1 npx vitest run test/price-gate.test.ts — อ่านผลแล้วตัดสินเอง (เชิงคุณภาพ)
 */
const RUN = process.env.PRICE_GATE === "1";
const MODEL = "claude-sonnet-4-6";
const URL = "https://api.anthropic.com/v1/messages";

// สินค้าที่ "หน่วยราคากำกวม" — ก๊อปสไตล์จริงจากคลัง Nathapat
const PRODUCTS: Product[] = [
  { id: "1", name: "ถ่านชาร์จ Vapcell G62 LiFePO4 3.2V 30A 6200mAh 2ก้อน แบตเตอรี่ 32700", description: "Vapcell G62 LiFePO4 3.2V 6200mAh 32700 จ่าย 30A (แพ็ก 2 ก้อน)", price: "295", stock: 95 },
  { id: "2", name: "ถ่านชาร์จ Vapcell G62 LiFePO4 3.2V 30A 6200mAh แบตเตอรี่ 32700 (1 ก้อน)", description: "Vapcell G62 LiFePO4 3.2V 6200mAh 32700 จ่าย 30A ราคาต่อ 1 ก้อน", price: "149", stock: 79 },
  { id: "3", name: "ถ่านชาร์จ LiFePO4 3.2V 6000mAh ราคา 1 ก้อน แบตเตอรี่ 32700", description: "LiFePO4 32700 3.2V 6000mAh จ่าย 5A ราคาต่อ 1 ก้อน", price: "98", stock: 323 },
  { id: "4", name: "แบตเตอรี่ 32140 LifePO4 15Ah สั่งประกอบ สั่งแพ๊กตามจำนวนที่ลูกค้าต้องการ", description: "LiFePO4 3.2V 15Ah ต่อก้อน ประกอบตามสั่ง กำหนดจำนวนเซลล์/รูปแบบได้", price: "2100", stock: 187 },
  { id: "5", name: "BMS 16S 50A ระบบ 48V สำหรับ Lifepo4 3.2V", description: "BMS 16S 48V จ่ายต่อเนื่อง 50A (ต่อชิ้น)", price: "590", stock: 10 },
];

const MSGS = [
  "ถ่าน G62 32700 ราคาเท่าไหร่",                        // ควรระบุหน่วย: 1ก้อน 149 / แพ็ก2 295
  "อยากได้ถ่าน LiFePO4 32700 6000mAh 6 ก้อน ราคาเท่าไหร่", // ก้อนละ 98 × 6 = 588 + โชว์วิธีคิด
  "แบต 32140 อยากสั่ง 20 ก้อน ราคาเท่าไหร่",              // สั่งประกอบ → ควรถามยืนยัน ไม่เดา 2100×20
  "ถ่าน G62 เอา 2 แพ็ก เท่าไหร่",                        // 295 × 2 = 590
];

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

async function ask(msg: string): Promise<string> {
  const content = buildUserContent({
    shopName: "ร้านแบต", shopVoice: "", shopMemory: "", shopGender: "female",
    products: PRODUCTS, customerMsg: msg, promotions: [],
  });
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system: REPLY_SYSTEM_PROMPT, messages: [{ role: "user", content }] }),
  });
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const raw = data.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return j.message ?? raw;
  } catch {
    return raw;
  }
}

describe.runIf(RUN)("price gate (ยิง API จริง)", () => {
  it("ราคา/หน่วย/รวมราคา", async () => {
    loadEnv();
    const out: string[] = ["# ด่านทดสอบ ราคา+หน่วย (กฎใหม่)", ""];
    for (const msg of MSGS) {
      const m = await ask(msg);
      out.push(`**Q:** ${msg}`, `> ${m}`, "");
      console.log("done: " + msg);
    }
    writeFileSync(process.env.GATE_OUT || "price-gate.md", out.join("\n"));
  }, 300_000);
});
