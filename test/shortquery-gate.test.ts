import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContent, REPLY_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบ "ข้อความสั้น/คำย่อ/พิมพ์ไม่ครบ" (feedback ร้าน 25 ก.ค.: ลูกค้าพิมพ์ "balance ไหม"
 * แล้ว AI เดาผิด ให้ข้อมูลไม่ตรง/เสนอตัวอื่นเหมือนเข้าใจแล้ว)
 * กฎ 2.1: ชัดตัวเดียว→ตอบพร้อมทวนชื่อ · หลายตัว→ถามพร้อมยกตัวเลือก · ไม่เจอ→ถามขยายความ
 * ห้ามมั่วเสนอตัวอื่น · ขยายความแล้วยังมืด→ส่งแอดมิน (needs_human=true)
 * รัน: SHORTQUERY_GATE=1 npx vitest run test/shortquery-gate.test.ts — อ่านผลแล้วตัดสินเอง
 */
const RUN = process.env.SHORTQUERY_GATE === "1";
const MODEL = "claude-sonnet-4-6";
const URL = "https://api.anthropic.com/v1/messages";

// คลังพื้นฐาน (ไม่มีอะไรเกี่ยวกับ balance)
const BASE: Product[] = [
  { id: "1", name: "ถ่านชาร์จ Beston AA / AAA 1.5V ชุด 4 ก้อน และที่ชาร์จ USB", description: "ถ่านลิเธียม 1.5V AA 3600mWh ชุด 4 ก้อนพร้อมที่ชาร์จ · มีให้เลือก: สีส้ม/สีเขียว", price: "499", stock: 24 },
  { id: "2", name: "Xtar ถ่านชาร์จขนาด AA 1.5V 4150mWh (2500mAh) ชุด 4 ก้อน", description: "ถ่านลิเธียม AA 1.5V ความจุ 4150mWh ชาร์จเร็ว MAX output 2A", price: "780", stock: 12 },
];

// คลังที่มี "balance" ตัวเดียวชัด
const ONE_MATCH: Product[] = [
  ...BASE,
  { id: "3", name: "เครื่องชาร์จ SkyRC iMAX B6 Balance Charger", description: "เครื่องชาร์จบาลานซ์ ชาร์จแบตลิโพ/ลิเธียม 1-6S ปรับกระแสได้", price: "890", stock: 5 },
];

// คลังที่ "balance" ชี้ได้ 2 ตัว (เครื่องชาร์จบาลานซ์ + BMS มีฟังก์ชันบาลานซ์)
const TWO_MATCH: Product[] = [
  ...ONE_MATCH,
  { id: "4", name: "BMS 4S 100A LiFePO4 พร้อมระบบ balance ในตัว", description: "บอร์ดป้องกันแบต 4S มี cell balancing ในตัว จ่ายต่อเนื่อง 100A", price: "450", stock: 9 },
];

const CASES: { products: Product[]; set: string; msg: string; expect: string }[] = [
  { products: ONE_MATCH, set: "ชัดตัวเดียว", msg: "มี balance ไหม", expect: "ตอบ iMAX B6 ได้เลย แต่ต้องทวนชื่อที่เข้าใจ (หมายถึงเครื่องชาร์จบาลานซ์ B6 ใช่ไหม) ให้ลูกค้าแย้งได้" },
  { products: TWO_MATCH, set: "ชี้ได้ 2 ตัว", msg: "มี balance ไหม", expect: "ถามกลับพร้อมยกตัวเลือก: เครื่องชาร์จ B6 หรือ BMS 4S — ไม่เดาตอบตัวใดตัวหนึ่ง" },
  { products: BASE, set: "ไม่มีในคลัง", msg: "มี balance ไหม", expect: "ถามขยายความ ห้ามมั่วเสนอถ่าน Beston/Xtar เหมือนเข้าใจแล้ว (needs_human=false)" },
  { products: BASE, set: "ขยายความแล้วยังมืด", msg: "แชตก่อนหน้า — ลูกค้า: มี balance ไหม / ร้าน: ขอรายละเอียดเพิ่มหน่อยครับว่าหมายถึงอุปกรณ์แบบไหน / ลูกค้า (ล่าสุด): ก็ตัวที่เพื่อนผมเคยซื้อไปอะ", expect: "ยังระบุไม่ได้ → ตอบรับเรื่องสั้นๆ + ส่งแอดมิน (needs_human=true) ไม่วนถามซ้ำ" },
  { products: ONE_MATCH, set: "control คำถามครบ", msg: "ถ่าน Beston AA มีของไหม", expect: "ตอบตรงๆ ว่ามี ไม่ถามกลับให้เสียจังหวะ (กฎใหม่ต้องไม่ทำให้ถามพร่ำเพรื่อ)" },
];

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

async function ask(products: Product[], msg: string): Promise<{ message: string; needsHuman: unknown }> {
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
    return { message: j.message ?? raw, needsHuman: j.needs_human };
  } catch {
    return { message: raw, needsHuman: undefined };
  }
}

describe.runIf(RUN)("shortquery gate (ยิง API จริง)", () => {
  it("คำย่อ/พิมพ์ไม่ครบ — ห้ามเดาตอบเหมือนแน่ใจ", async () => {
    loadEnv();
    const out: string[] = ["# ด่านทดสอบ ข้อความสั้น/คำย่อ (กฎ 2.1)", ""];
    for (const c of CASES) {
      const r = await ask(c.products, c.msg);
      out.push(`**Q (${c.set}):** ${c.msg}`, `**คาดหวัง:** ${c.expect}`, `> ${r.message}`, `- needs_human: ${String(r.needsHuman)}`, "");
      console.log("done: " + c.set);
    }
    writeFileSync(process.env.GATE_OUT || "shortquery-gate.md", out.join("\n"));
  }, 300_000);
});
