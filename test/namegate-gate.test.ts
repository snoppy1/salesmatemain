import { describe, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildUserContentParts, REPLY_SYSTEM_PROMPT, COMPRESS_NAME_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบ "ล้างชื่อสินค้าสำหรับ AI" — ยิง API จริง เสียเครดิตจริง
 * ขั้น 1 (prep): NAME_GATE=prep → ล้างชื่อทั้งคลังจาก snapshot เก็บลงไฟล์ CLEANED_PATH (ยังไม่แตะ DB)
 * ขั้น 2 (ab):   NAME_GATE=ab   → เทียบคำตอบ ชื่อเดิม vs ชื่อสะอาด 9 เคส
 */

const MODE = process.env.NAME_GATE ?? "";
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const USD_TO_THB = 34;

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

type Snap = {
  shopName: string;
  shopVoice: string;
  shopMemory: string;
  products: (Omit<Product, "id"> & { id?: string })[];
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

function costTHB(u: Usage): number {
  const usd =
    ((u.input_tokens ?? 0) * 3 +
      (u.cache_creation_input_tokens ?? 0) * 3 * 2 +
      (u.cache_read_input_tokens ?? 0) * 3 * 0.1 +
      (u.output_tokens ?? 0) * 15) /
    1_000_000;
  return usd * USD_TO_THB;
}

const CASES = [
  { id: 1, q: "มีวงจร BMS 8S 24V ไหมครับ", expect: "ตัว 25A/1800A หมด — บอกหมด; เสนอตัว Active Balance 480บ. (มีของ) แทนได้" },
  { id: 2, q: "วงจร BMS 8S(24V) 25A ราคาเท่าไหร่ครับ", expect: "195 บาท + แจ้งของหมด" },
  { id: 3, q: "มีเครื่องชาร์จถ่าน 18650 แบบหลายช่องไหมครับ", expect: "เสนอรุ่นมีของ ราคาตรง (Lii-S12 1250, Lii-S8 1199, D4XL 680...)" },
  { id: 4, q: "แบตสามล้อไฟฟ้า 48V 20Ah เหลือกี่ลูกครับ", expect: "ตอบจำนวนตรงตามสต็อกจริง" },
  { id: 5, q: "สนใจแบตจักรยานไฟฟ้า 48V 15Ah ตัว 4800 บาท มีอะไรแนะนำซื้อคู่กันไหมครับ", expect: "พ่วงเฉพาะของมีสต็อก ห้ามเสนอชาร์จไว5A (หมด)" },
  { id: 6, q: "มีโซลาร์ชาร์จเจอร์ MPPT ขายไหมครับ", expect: "มีสินค้ากลุ่มนี้แต่หมดชั่วคราวทุกตัว — ห้ามบอกมีพร้อมส่ง/ห้ามบอกไม่มีขาย" },
  { id: 7, q: "มีกล้องวงจรปิดขายไหมครับ", expect: "ไม่มีขาย (ไม่มโน) — เสนอ DC adapter 12V ที่เกี่ยวได้" },
  { id: 8, q: "Holder Bracket 18650 ยังมีของไหมครับ", expect: "ของหมด" },
  { id: 9, q: "BMS 8S หมดใช่ไหมครับ มีตัวไหนใช้แทนได้บ้าง", expect: "ยืนยันหมด + เสนอตัวมีของใกล้เคียง" },
];

async function ask(system: string, stable: string, promo: string, customer: string) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: stable, cache_control: { type: "ephemeral", ttl: "1h" } },
            { type: "text", text: promo, cache_control: { type: "ephemeral", ttl: "1h" } },
            { type: "text", text: `\n\n${customer}` },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Usage };
  const raw = data.content?.find((c) => c.type === "text")?.text ?? "";
  let msg = raw;
  let upsell = "";
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    msg = j.message ?? raw;
    upsell = j.upsell_product ?? "";
  } catch { /* เก็บ raw */ }
  return { msg, upsell, usage: data.usage ?? {} };
}

describe.runIf(MODE === "prep")("namegate: ล้างชื่อทั้งคลังจาก snapshot", () => {
  it("เรียก AI ล้างชื่อ แล้วเก็บลงไฟล์", async () => {
    loadEnv();
    const snap = JSON.parse(readFileSync(process.env.SNAPSHOT_PATH as string, "utf8")) as Snap;
    const names = [...new Set(snap.products.filter((p) => p.enabled !== false).map((p) => p.name.trim()))];
    const todo = names.filter((n) => n.length > 48);
    const map: Record<string, string> = {};
    let thb = 0;
    const BATCH = 10;
    for (let i = 0; i < todo.length; i += BATCH) {
      const results = await Promise.all(
        todo.slice(i, i + BATCH).map(async (n) => {
          const res = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY as string,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: MODEL,
              max_tokens: 120,
              system: COMPRESS_NAME_SYSTEM_PROMPT,
              messages: [{ role: "user", content: n }],
            }),
          });
          if (!res.ok) return { n, out: "", u: {} as Usage };
          const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Usage };
          const txt = (data.content?.find((c) => c.type === "text")?.text ?? "").trim();
          const ok = txt && txt.length < n.length && txt.length <= 90 && !txt.includes("\n");
          return { n, out: ok ? txt : "", u: data.usage ?? {} };
        }),
      );
      for (const r of results) {
        if (r.out) map[r.n] = r.out;
        thb += costTHB(r.u);
      }
    }
    const outPath = process.env.CLEANED_PATH as string;
    writeFileSync(outPath, JSON.stringify(map, null, 1));
    const sample = Object.entries(map).slice(0, 12);
    const lines = [
      `ชื่อทั้งหมด ${names.length} | ยาวเกิน 48 ตัวอักษร ${todo.length} | ล้างสำเร็จ ${Object.keys(map).length} | ค่าล้าง ฿${thb.toFixed(2)}`,
      "", "ตัวอย่าง (เดิม → ใหม่):",
      ...sample.map(([a, b]) => `- ${a}\n  → ${b}`),
    ];
    writeFileSync(process.env.GATE_OUT || "namegate-prep.txt", lines.join("\n"));
  }, 600_000);
});

describe.runIf(MODE === "ab")("namegate: เทียบคำตอบ ชื่อเดิม vs ชื่อสะอาด", () => {
  it("A/B 9 เคส", async () => {
    loadEnv();
    const snap = JSON.parse(readFileSync(process.env.SNAPSHOT_PATH as string, "utf8")) as Snap;
    const cleaned = JSON.parse(readFileSync(process.env.CLEANED_PATH as string, "utf8")) as Record<string, string>;
    const base: Product[] = snap.products.map((p, i) => ({ ...p, id: p.id ?? String(i) })) as Product[];
    const withAi: Product[] = base.map((p) => ({ ...p, aiName: cleaned[p.name.trim()] || undefined }));

    const runVariant = async (products: Product[], label: string) => {
      const rows: { id: number; msg: string; upsell: string }[] = [];
      let thb = 0;
      for (const c of CASES) {
        const parts = buildUserContentParts({
          shopName: snap.shopName, shopVoice: snap.shopVoice, shopMemory: snap.shopMemory,
          products, customerMsg: c.q, promotions: [],
        });
        const r = await ask(REPLY_SYSTEM_PROMPT, parts.stable, parts.promo, parts.customer);
        thb += costTHB(r.usage);
        rows.push({ id: c.id, msg: r.msg, upsell: r.upsell });
        console.log(`[${label}] เคส ${c.id} เสร็จ`);
      }
      return { rows, thb };
    };

    const sizeOld = buildUserContentParts({ shopName: snap.shopName, shopVoice: snap.shopVoice, shopMemory: snap.shopMemory, products: base, customerMsg: "x", promotions: [] }).stable.length;
    const sizeNew = buildUserContentParts({ shopName: snap.shopName, shopVoice: snap.shopVoice, shopMemory: snap.shopMemory, products: withAi, customerMsg: "x", promotions: [] }).stable.length;

    const [oldRun, newRun] = await Promise.all([
      runVariant(base, "old"),
      runVariant(withAi, "new"),
    ]);

    const md: string[] = [
      `# ผลด่านทดสอบ: ล้างชื่อสินค้า (${MODEL})`, "",
      `- stable เดิม ${sizeOld.toLocaleString()} ตัวอักษร → ใหม่ ${sizeNew.toLocaleString()} (ลด ${(100 - (sizeNew / sizeOld) * 100).toFixed(1)}%)`,
      `- ค่าเทส: เดิม ฿${oldRun.thb.toFixed(2)} + ใหม่ ฿${newRun.thb.toFixed(2)} = ฿${(oldRun.thb + newRun.thb).toFixed(2)}`, "",
    ];
    for (const c of CASES) {
      const o = oldRun.rows.find((r) => r.id === c.id);
      const n = newRun.rows.find((r) => r.id === c.id);
      md.push(`## เคส ${c.id}: ${c.q}`, `**คาดหวัง:** ${c.expect}`, "",
        `**ชื่อเดิม** (พ่วง=${o?.upsell || "-"}):`, `> ${o?.msg}`, "",
        `**ชื่อสะอาด** (พ่วง=${n?.upsell || "-"}):`, `> ${n?.msg}`, "");
    }
    writeFileSync(process.env.GATE_OUT || "namegate-ab.md", md.join("\n"));
  }, 900_000);
});
