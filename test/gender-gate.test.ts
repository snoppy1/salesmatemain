import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContent, REPLY_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบ "เพศ AI คุมคำลงท้าย" — ยิง API จริง เสียเครดิต
 * รัน: GENDER_GATE=1 npx vitest run test/gender-gate.test.ts
 * เช็ค: male → มี "ครับ" ไม่มี "ค่ะ/คะ"; female → มี "ค่ะ/คะ" ไม่มี "ครับ"
 */
const RUN = process.env.GENDER_GATE === "1";
const MODEL = "claude-sonnet-4-6";
const URL = "https://api.anthropic.com/v1/messages";

const PRODUCTS: Product[] = [
  { id: "1", name: "แบตเตอรี่จักรยานไฟฟ้า 48V 15Ah LiFePO4", description: "วิ่งไกล 50 กม./ชาร์จ", price: "4800", stock: 12 },
  { id: "2", name: "เครื่องชาร์จแบตจักรยานไฟฟ้า ชาร์จไว 5A", description: "ชาร์จเต็มไว", price: "400", stock: 8 },
  { id: "3", name: "BMS 16S 50A ระบบ 48V สำหรับ Lifepo4", description: "วงจรป้องกันแบต", price: "590", stock: 5 },
];

const MSGS = [
  "แบต 48V 15Ah ราคาเท่าไหร่",
  "สนใจแบต 48V 15Ah มีอะไรแนะนำซื้อคู่กันไหม",
  "สวัสดีครับ พอดีอยากได้แบตจักรยานไฟฟ้า",
];

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

async function ask(gender: "male" | "female", msg: string): Promise<string> {
  const content = buildUserContent({
    shopName: "ร้านแบต", shopVoice: "", shopMemory: "", shopGender: gender,
    products: PRODUCTS, customerMsg: msg, promotions: [],
  });
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 800,
      system: REPLY_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    }),
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

describe.runIf(RUN)("gender gate (ยิง API จริง)", () => {
  it("male=ครับ / female=ค่ะ ไม่ปน", async () => {
    loadEnv();
    const out: string[] = ["# ด่านทดสอบเพศ AI", ""];
    for (const gender of ["male", "female"] as const) {
      out.push(`## เพศ = ${gender}`);
      for (const msg of MSGS) {
        const m = await ask(gender, msg);
        const hasKrap = /ครับ/.test(m);
        const hasKa = /ค่ะ|คะ/.test(m);
        const ok = gender === "male" ? hasKrap && !hasKa : hasKa && !hasKrap;
        out.push(`**Q:** ${msg}`, `> ${m}`, `ผล: ครับ=${hasKrap} ค่ะ/คะ=${hasKa} → ${ok ? "✅ ถูก" : "❌ ปน!"}`, "");
        console.log(`[${gender}] ${ok ? "OK" : "FAIL-ปน"} : ${msg}`);
      }
    }
    writeFileSync(process.env.GATE_OUT || "gender-gate.md", out.join("\n"));
  }, 300_000);
});
