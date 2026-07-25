import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContent, REPLY_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบ "สี/ตัวเลือกสินค้า" (feedback ร้าน Smarttech 25 ก.ค.: ลูกค้าถามถ่าน AA สีส้มกับสีเขียว
 * ซึ่งเป็นตัวเลือกสีของ Beston ตัวเดียวกัน แต่ AI มโนว่าสีเขียวคือ Xtar แล้วอธิบายความต่างที่ไม่มีจริง)
 * รัน: VARIANT_GATE=1 npx vitest run test/variant-gate.test.ts — อ่านผลแล้วตัดสินเอง (เชิงคุณภาพ)
 */
const RUN = process.env.VARIANT_GATE === "1";
const MODEL = "claude-sonnet-4-6";
const URL = "https://api.anthropic.com/v1/messages";

// ก๊อปสไตล์จริงจากคลัง Smarttech — ชุดที่ "มีข้อมูลตัวเลือกสี" (หลังแก้ import)
const WITH_NOTE: Product[] = [
  { id: "1", name: "ถ่านชาร์จ Beston AA / AAA 1.5V ชุด 4 ก้อน และที่ชาร์จ USB", description: "ถ่านลิเธียม 1.5V AA 3600mWh ชุด 4 ก้อนพร้อมที่ชาร์จ ใช้กับเมาส์ รีโมต คอนโทรลเกมส์ · มีให้เลือก: สีส้ม/สีเขียว", price: "499", stock: 24 },
  { id: "2", name: "Xtar ถ่านชาร์จขนาด AA 1.5V 4150mWh (2500mAh) ชุด 4 ก้อน", description: "ถ่านลิเธียม AA 1.5V ความจุ 4150mWh ชาร์จเร็ว MAX output 2A", price: "780", stock: 12 },
  { id: "3", name: "เครื่องชาร์จ LiitoKala D4 รองรับ AA/AAA และ 18650", description: "เครื่องชาร์จ 4 ช่อง รองรับถ่านหลายขนาด รับประกัน 1 ปี", price: "535", stock: 8 },
];

// ชุดเดียวกันแต่ "ไม่มีข้อมูลตัวเลือกสี" (สภาพก่อนแก้ import / ร้านยังไม่ re-import)
const NO_NOTE: Product[] = WITH_NOTE.map((p) =>
  p.id === "1" ? { ...p, description: "ถ่านลิเธียม 1.5V AA 3600mWh ชุด 4 ก้อนพร้อมที่ชาร์จ ใช้กับเมาส์ รีโมต คอนโทรลเกมส์" } : { ...p },
);

// ชุด "ราคาต่อตัวเลือกไม่เท่ากัน" (สีเขียว 520 แพงกว่าราคากลาง 499)
const WITH_PRICE: Product[] = WITH_NOTE.map((p) =>
  p.id === "1" ? { ...p, description: "ถ่านลิเธียม 1.5V AA 3600mWh ชุด 4 ก้อนพร้อมที่ชาร์จ ใช้กับเมาส์ รีโมต คอนโทรลเกมส์ · มีให้เลือก: สีส้ม 499 บาท/สีเขียว 520 บาท" } : { ...p },
);

// (products, คำถาม, สิ่งที่คาดหวัง — ไว้อ่านตอนตัดสิน)
const CASES: { products: Product[]; set: string; msg: string; expect: string }[] = [
  { products: WITH_NOTE, set: "มีข้อมูลสี", msg: "ถ่าน AA สีส้มกับสีเขียวต่างกันยังไง", expect: "ตัวเดียวกัน (Beston) ต่างแค่สี สเปกเหมือนกัน — ห้ามโยงสีเขียวเป็น Xtar" },
  { products: NO_NOTE, set: "ไม่มีข้อมูลสี", msg: "ถ่าน AA สีส้มกับสีเขียวต่างกันยังไง", expect: "ไม่มีข้อมูลสี → ถามกลับว่าหมายถึงตัวไหน ห้ามแต่งความต่าง/ห้ามเดาว่าเขียว=Xtar" },
  { products: WITH_NOTE, set: "มีข้อมูลสี", msg: "เอาถ่าน Beston สีเขียวมีของไหม", expect: "มีของ — สีเขียวเป็นตัวเลือกของ Beston เอง" },
  { products: WITH_NOTE, set: "มีข้อมูลสี", msg: "Beston กับ Xtar ต่างกันยังไง", expect: "(control) ยังเปรียบเทียบสองรุ่นได้ปกติ: ความจุ/ราคาต่างกันจริง" },
  { products: WITH_PRICE, set: "ราคาต่อสีต่างกัน", msg: "ถ่าน Beston สีเขียวราคาเท่าไหร่", expect: "520 บาท (ราคาของตัวเลือกสีเขียว) ไม่ใช่ 499" },
  { products: WITH_PRICE, set: "ราคาต่อสีต่างกัน", msg: "ถ่าน AA สีส้มกับสีเขียวต่างกันยังไง", expect: "ตัวเดียวกัน สเปกเดียวกัน ต่างแค่สีและราคา: ส้ม 499 เขียว 520" },
  { products: WITH_PRICE, set: "ราคาต่อสีต่างกัน", msg: "เอา Beston สีเขียว 2 ชุดเท่าไหร่", expect: "520 × 2 = 1040 บาท โชว์วิธีคิด — ห้ามใช้ 499 คิด" },
];

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

async function ask(products: Product[], msg: string): Promise<string> {
  const content = buildUserContent({
    shopName: "Smarttech Shop", shopVoice: "", shopMemory: "", shopGender: "male",
    products, customerMsg: msg, promotions: [],
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

describe.runIf(RUN)("variant gate (ยิง API จริง)", () => {
  it("สี/ตัวเลือกสินค้า — ห้ามมโนความต่าง", async () => {
    loadEnv();
    const out: string[] = ["# ด่านทดสอบ สี/ตัวเลือกสินค้า (กฎ 1.2 + มีให้เลือก:)", ""];
    for (const c of CASES) {
      const m = await ask(c.products, c.msg);
      out.push(`**Q (${c.set}):** ${c.msg}`, `**คาดหวัง:** ${c.expect}`, `> ${m}`, "");
      console.log("done: " + c.msg);
    }
    writeFileSync(process.env.GATE_OUT || "variant-gate.md", out.join("\n"));
  }, 300_000);
});
