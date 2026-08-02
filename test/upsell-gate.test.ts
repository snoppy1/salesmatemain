import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContent, REPLY_SYSTEM_PROMPT, buildConversationContext } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบ "จังหวะทองพ่วง" (กฎ 4.1) — จากข้อมูลจริง: คนซื้อจริง 5 ราย ถูกเสนอพ่วงแค่ 1 (และปิดได้)
 * รัน: UPSELL_GATE=1 npx vitest run test/upsell-gate.test.ts — ยิง Sonnet จริง 6 calls (เผาเครดิตจริง)
 * เกณฑ์: เคสบังคับ assert แข็ง + เขียนผลลง md ให้อ่านโทน/ความยาวเชิงคุณภาพ
 */
const RUN = process.env.UPSELL_GATE === "1";
const MODEL = "claude-sonnet-4-6";
const URL = "https://api.anthropic.com/v1/messages";

// ร้านแบตจำลองสไตล์ Smarttech — มีคู่พ่วงชัด: แบตแพ็ก↔BMS, ถ่าน↔ที่ชาร์จ/เคสใส่ถ่าน
const MAIN_BATTERY: Product = { id: "1", name: "แบตเตอรี่ 32140 LiFePO4 15Ah สั่งประกอบตามจำนวน", description: "LiFePO4 3.2V 15Ah ต่อก้อน ประกอบแพ็กตามสั่ง", price: "2100", stock: 50 };
const PRODUCTS: Product[] = [
  MAIN_BATTERY,
  { id: "2", name: "BMS 8S 24V 40A สำหรับ LiFePO4", description: "บอร์ดป้องกันแบตแพ็ก 8S จ่ายต่อเนื่อง 40A", price: "480", stock: 12 },
  { id: "3", name: "ถ่านชาร์จ 18650 Li-ion 3.7V 3000mAh", description: "ถ่านชาร์จ 18650 หัวแบน 3000mAh ของแท้", price: "149", stock: 80 },
  { id: "4", name: "เครื่องชาร์จถ่าน 18650 ราง 2 ช่อง จอ LED", description: "ชาร์จถ่าน Li-ion/NiMH ตัดไฟอัตโนมัติ", price: "390", stock: 9 },
  { id: "5", name: "เคสใส่ถ่าน 18650 กันกระแทก (2 ก้อน)", description: "กล่องพลาสติกใส่ถ่าน กันช็อต กันตก", price: "25", stock: 100 },
];

// เคส 5: คลังไม่มีของเข้าคู่เลย (มีแต่ตัวหลักตัวเดียว)
const PRODUCTS_NO_PAIR: Product[] = [MAIN_BATTERY];

type Reply = {
  should_upsell?: boolean;
  needs_human?: boolean;
  message?: string;
  upsell_product?: string;
  est_added_value?: number | null;
};

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

async function ask(customerMsg: string, products: Product[] = PRODUCTS): Promise<Reply> {
  const content = buildUserContent({
    shopName: "ร้านแบตทดสอบ", shopVoice: "", shopMemory: "", shopGender: "female",
    products, customerMsg, promotions: [],
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
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Reply;
  } catch {
    return { message: raw };
  }
}

/** ประกอบ customerMsg จากประวัติแชต — ฟอร์แมตเดียวกับ prod เป๊ะ */
function convo(
  messages: { sender: "customer" | "admin"; text: string }[],
  channel = "lazada",
): string {
  return buildConversationContext("ลูกค้าทดสอบ", channel, messages).text;
}

describe.runIf(RUN)("upsell gate — จังหวะทอง (ยิง API จริง)", () => {
  const out: string[] = ["# ด่านทดสอบ จังหวะทองพ่วง (กฎ 4.1)", ""];
  const log = (title: string, r: Reply) => {
    out.push(`## ${title}`, `- should_upsell: ${r.should_upsell} · upsell_product: ${r.upsell_product ?? ""} · est: ${r.est_added_value ?? ""}`, `> ${r.message ?? "(no message)"}`, "");
  };

  it("1. สัญญาณซื้อ (แบตแพ็ก) → ต้องพ่วง BMS", async () => {
    loadEnv();
    const r = await ask(convo([
      { sender: "customer", text: "แบต 32140 มีของไหมครับ" },
      { sender: "admin", text: "มีพร้อมส่งค่ะ ก้อนละ 2,100 บาท สั่งประกอบตามจำนวนได้เลยค่ะ" },
      { sender: "customer", text: "เอา 8 ก้อนครับ สั่งยังไง" },
    ]));
    log("1. สัญญาณซื้อ แบต 8 ก้อน", r);
    expect(r.should_upsell).toBe(true);
    expect((r.upsell_product ?? "").length).toBeGreaterThan(0);
  }, 60_000);

  it("2. สัญญาณซื้อ (ถ่าน 18650 เดี๋ยวกดสั่งเลย) → ต้องพ่วง", async () => {
    loadEnv();
    const r = await ask(convo([
      { sender: "customer", text: "ถ่าน 18650 3000mAh มีของพร้อมส่งไหมครับ เดี๋ยวกดสั่งเลย" },
    ]));
    log("2. สัญญาณซื้อ ถ่าน 18650", r);
    expect(r.should_upsell).toBe(true);
    expect((r.upsell_product ?? "").length).toBeGreaterThan(0);
  }, 60_000);

  it("3. ถามราคาลอยๆ → ตอบปกติ (พ่วงได้แต่ไม่บังคับ — ดูโทนใน md)", async () => {
    loadEnv();
    const r = await ask(convo([{ sender: "customer", text: "ถ่าน 18650 ราคาเท่าไหร่ครับ" }]));
    log("3. ถามราคาลอยๆ (control โทน)", r);
    expect((r.message ?? "").length).toBeGreaterThan(0);
  }, 60_000);

  it("4. ลูกค้าเคลม → ห้ามพ่วงเด็ดขาด", async () => {
    loadEnv();
    const r = await ask(convo([
      { sender: "customer", text: "ถ่านที่ได้มาชาร์จไม่เข้าเลยครับ จะเคลมยังไง" },
    ]));
    log("4. เคลมของเสีย", r);
    expect(r.should_upsell).toBe(false);
  }, 60_000);

  it("5. สัญญาณซื้อแต่ไม่มีของเข้าคู่ในคลัง → ไม่ฝืนเสนอ", async () => {
    loadEnv();
    const r = await ask(
      convo([{ sender: "customer", text: "เอาแบต 32140 สัก 4 ก้อนครับ สั่งยังไง" }]),
      PRODUCTS_NO_PAIR,
    );
    log("5. ไม่มีของเข้าคู่", r);
    expect(r.should_upsell).toBe(false);
  }, 60_000);

  it("6. เคยเสนอ BMS แล้วลูกค้าไม่รับ → ห้ามตื๊อตัวเดิม", async () => {
    loadEnv();
    const r = await ask(convo([
      { sender: "customer", text: "แบต 32140 เอา 8 ก้อนครับ" },
      { sender: "admin", text: "ได้เลยค่ะ รับ BMS 8S คู่กันไหมคะ เพิ่มแค่ 480 บาท ต่อแล้วใช้ได้ปลอดภัยเลยค่ะ" },
      { sender: "customer", text: "ไม่เอา BMS ครับ เอาแบตอย่างเดียว สั่งเลยยังไง" },
    ]));
    log("6. ปฏิเสธ BMS แล้ว", r);
    writeFileSync(process.env.GATE_OUT || "upsell-gate.md", out.join("\n")); // เขียนผลก่อน assert — อ่านได้แม้เคสตก
    // ห้ามเสนอ BMS ซ้ำ — เสนอชิ้นอื่นที่เข้าคู่ได้ (ไม่มีในคลังนี้ก็ไม่เสนอเลย)
    expect((r.upsell_product ?? "").includes("BMS")).toBe(false);
  }, 60_000);
});

describe.runIf(RUN)("ช่องทาง — วิธีสั่งตามแพลตฟอร์ม (กฎ 10, ยิง API จริง)", () => {
  const out: string[] = ["# ด่านทดสอบ วิธีสั่งตามช่องทาง (กฎ 10)", ""];
  const log = (title: string, r: Reply) => {
    out.push(`## ${title}`, `- needs_human: ${r.needs_human} · should_upsell: ${r.should_upsell}`, `> ${r.message ?? "(no message)"}`, "");
  };

  it("7. แชต Lazada ถามวิธีสั่ง → ชี้ไปกดสั่งในแอป ห้ามขอที่อยู่/ชวนโอน", async () => {
    loadEnv();
    const r = await ask(convo([
      { sender: "customer", text: "เอาเครื่องชาร์จ 18650 ตัวนี้ครับ สั่งยังไง" },
    ], "lazada"));
    log("7. Lazada สั่งยังไง", r);
    const msg = r.message ?? "";
    // ห้าม "ขอ" ที่อยู่ (พูดถึงเฉยๆ ได้ เช่น "ระบบจัดการที่อยู่ให้เอง") + ห้ามชวนโอนนอกระบบ
    expect(/(แจ้ง|ขอ|ส่ง|บอก|กรอก)ที่อยู่/.test(msg)).toBe(false);
    expect(msg.includes("โอน")).toBe(false);
  }, 60_000);

  it("8. แชต LINE ถามวิธีสั่ง → รับออเดอร์ในแชตได้ ไม่พาไปกดแอปอื่น", async () => {
    loadEnv();
    const r = await ask(convo([
      { sender: "customer", text: "เอาเครื่องชาร์จ 18650 ตัวนี้ครับ สั่งยังไง" },
    ], "line"));
    log("8. LINE สั่งยังไง", r);
    writeFileSync(process.env.GATE_OUT2 || "upsell-gate-channel.md", out.join("\n"));
    expect(/lazada/i.test(r.message ?? "")).toBe(false); // แชต LINE ไม่พาไปกด Lazada
  }, 60_000);
});
