import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUserContentParts, REPLY_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Product } from "@/lib/types";

/**
 * ด่านทดสอบคุณภาพ "ยุบสินค้าหมดในดัชนี" (ชุดที่ 2) — ยิง API จริง เสียเครดิตจริง
 * รันเฉพาะเมื่อสั่งเอง: GATE_SOLDOUT=1 SNAPSHOT_PATH=<catalog.json> npx vitest run test/soldout-gate.test.ts
 * เทียบคำตอบ prompt แบบเดิม (ของหมดอยู่ในดัชนีพร้อมแท็ก) vs แบบใหม่ (ของหมดแยกส่วนชื่ออย่างเดียว)
 */

const RUN = process.env.GATE_SOLDOUT === "1";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const USD_TO_THB = 34;

/* ---------- แบบเดิม (ก๊อปพฤติกรรม prompt.ts ก่อนแก้ ไว้เป็น baseline) ---------- */

function legacyShortName(name: string, maxChars = 70): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length <= maxChars) return n;
  const slice = n.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…";
}

function legacyBriefLine(p: Product): string {
  const price = p.price.trim() ? ` (ราคา ${p.price.trim()} บาท)` : "";
  const stock =
    typeof p.stock !== "number" ? "" : p.stock <= 0 ? " [สินค้าหมด]" : " [มีสต็อก]";
  return `- ${legacyShortName(p.name)}${price}${stock}`;
}

const NEW_SYS_CATALOG_LINE =
  "ข้อมูลสินค้า: คลังอาจแบ่งเป็นส่วน — [รายการสินค้าในคลัง] (ชื่อ+ราคา+สต็อก ใช้ดูว่ามีอะไรขาย/หาของเข้าคู่เพื่อพ่วง), [สินค้าที่ของหมดชั่วคราว] (ชื่ออย่างเดียว — ยังเป็นสินค้าของร้านแต่ตอนนี้ของหมด ลูกค้าถามถึงให้ตอบว่าของหมด เสนอตัวใกล้เคียงที่มีของแทนได้ ห้ามเสนอขาย/พ่วงของหมด) และ [รายละเอียด/สเปกของสินค้าที่เกี่ยวกับคำถามล่าสุด] (สเปกเต็ม ใช้ตอบเชิงลึก) ถ้าต้องการสเปกของของที่ไม่อยู่ในส่วนรายละเอียด ใช้เท่าที่อ่านได้จากชื่อ ไม่พอให้ถามลูกค้าหรือขอเช็ค อย่าเดาสเปกเอง";
const OLD_SYS_CATALOG_LINE =
  "ข้อมูลสินค้า: คลังอาจแบ่ง 2 ส่วน — [รายการสินค้าทั้งหมดในคลัง] (ชื่อ+ราคา+สต็อกทุกชิ้น ใช้ดูว่ามีอะไรขาย/ของหมดไหม/หาของเข้าคู่เพื่อพ่วง) และ [รายละเอียด/สเปกของสินค้าที่เกี่ยวกับคำถามล่าสุด] (สเปกเต็ม ใช้ตอบเชิงลึก) ถ้าต้องการสเปกของของที่ไม่อยู่ในส่วนรายละเอียด ใช้เท่าที่อ่านได้จากชื่อ ไม่พอให้ถามลูกค้าหรือขอเช็ค อย่าเดาสเปกเอง";
const NEW_RULE8 =
  '8. สต็อก: ถามแค่ "มีไหม/พร้อมส่งไหม/ยังมีไหม" → ตอบ "มีค่ะ/พร้อมส่งค่ะ" (คงเหลือ>0) หรือ "ของหมดค่ะ" ไม่บอกตัวเลขจำนวน; บอกจำนวนเฉพาะเมื่อถามตรงๆ "เหลือกี่ชิ้น/สต็อกเท่าไหร่"; สินค้าที่ระบุ [สินค้าหมด] หรืออยู่ในส่วนสินค้าที่ของหมด: เอ่ยถึงเพื่อบอกว่าของหมดได้เท่านั้น ห้ามพูดให้เข้าใจว่ามีของ/ชวนสั่งซื้อ (บอกราคาได้เมื่อลูกค้าถามถึงตัวนั้นเจาะจง พร้อมย้ำว่าของหมด) ของที่เสนอขาย/พ่วงต้องมีของเท่านั้น';
const OLD_RULE8 =
  '8. สต็อก: ถามแค่ "มีไหม/พร้อมส่งไหม/ยังมีไหม" → ตอบ "มีค่ะ/พร้อมส่งค่ะ" (คงเหลือ>0) หรือ "ของหมดค่ะ" ไม่บอกตัวเลขจำนวน; บอกจำนวนเฉพาะเมื่อถามตรงๆ "เหลือกี่ชิ้น/สต็อกเท่าไหร่"';
const LEGACY_SYSTEM = REPLY_SYSTEM_PROMPT
  .replace(NEW_SYS_CATALOG_LINE, OLD_SYS_CATALOG_LINE)
  .replace(NEW_RULE8, OLD_RULE8);
if (RUN && (LEGACY_SYSTEM.includes(NEW_SYS_CATALOG_LINE) || LEGACY_SYSTEM.includes(NEW_RULE8))) {
  throw new Error("แทนที่ system prompt เป็นแบบเดิมไม่สำเร็จ — สตริงไม่ตรงกับ prompt.ts");
}

function legacyStable(shop: Snap, enabled: Product[]): string {
  return `[ร้าน] ${shop.shopName.trim() || "ไม่ระบุชื่อร้าน"}

[โทนการพูดของร้าน]
${shop.shopVoice.trim() || "ไม่ระบุ"}

[สิ่งที่ร้านอยากให้ AI จำ (ข้อมูล/นโยบายร้าน — ใช้ตอบลูกค้าได้เลยถ้าตรงคำถาม)]
${shop.shopMemory.trim() || "ไม่ระบุ"}

[รายการสินค้าทั้งหมดในคลัง (ชื่อ+ราคา+สต็อก — ใช้ดูว่ามีอะไรขาย/แนะนำของที่เข้าคู่เพื่อเสนอพ่วง; สเปกละเอียดดูที่ส่วน 'รายละเอียดสินค้าที่เกี่ยวข้อง')]
${enabled.map(legacyBriefLine).join("\n")}`;
}

/* ---------- เคสทดสอบ ---------- */

const CASES = [
  { id: 1, q: "มีวงจร BMS 8S 24V ไหมครับ", expect: "หมดทั้ง 2 ตัว (195/729บ.) — ต้องบอกหมด ห้ามบอกมีพร้อมส่ง; เสนอ 7S 24V li-ion (374บ. มีของ) แทนได้" },
  { id: 2, q: "วงจร BMS 8S(24V) 25A ราคาเท่าไหร่ครับ", expect: "ราคา 195 บาท + แจ้งว่าของหมด" },
  { id: 3, q: "มีเครื่องชาร์จถ่าน 18650 แบบหลายช่องไหมครับ", expect: "มี — เสนอรุ่นที่มีของ (เช่น Lii-S12 1250, Lii-S8 1199, Lii-D4XL 680) ราคาตรง; ไม่เสนอรุ่นที่หมด (Nitecore D4/D2, VC4)" },
  { id: 4, q: "แบตสามล้อไฟฟ้า 48V 20Ah เหลือกี่ลูกครับ", expect: "26 ลูก (ถามจำนวนตรงๆ ตอบตัวเลขได้)" },
  { id: 5, q: "สนใจแบตจักรยานไฟฟ้า 48V 15Ah ตัว 4800 บาท มีอะไรแนะนำซื้อคู่กันไหมครับ", expect: "พ่วงได้เฉพาะของมีสต็อก — ห้ามเสนอเครื่องชาร์จแบตจักรยาน ชาร์จไว5A 400บ. (หมด)" },
  { id: 6, q: "มีโซลาร์ชาร์จเจอร์ MPPT ขายไหมครับ", expect: "ร้านมีสินค้ากลุ่มนี้แต่ของหมดชั่วคราวทุกตัว — ห้ามตอบ 'ไม่มีขาย' และห้ามบอกมีพร้อมส่ง" },
  { id: 7, q: "มีกล้องวงจรปิดขายไหมครับ", expect: "ไม่มีขาย (ไม่มโนสินค้านอกคลัง)" },
  { id: 8, q: "Holder Bracket 18650 ยังมีของไหมครับ", expect: "ของหมด (ทั้ง 2 รายการ Holder หมด)" },
  { id: 9, q: "BMS 8S หมดใช่ไหมครับ มีตัวไหนใช้แทนได้บ้าง", expect: "ยืนยันหมด + แนะนำตัวที่มีของใกล้เคียง (เช่น 7S 24V li-ion — ต่างเคมี ควรระบุ/ถามชนิดแบต)" },
];

/* ---------- helpers ---------- */

type Snap = {
  shopName: string;
  shopVoice: string;
  shopMemory: string;
  products: (Omit<Product, "id"> & { id?: string })[];
  promotions: unknown[];
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

function loadEnv() {
  const t = readFileSync(".env.local", "utf8");
  for (const l of t.split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

function costTHB(u: Usage): number {
  const inUsd =
    ((u.input_tokens ?? 0) * 3 +
      (u.cache_creation_input_tokens ?? 0) * 3 * 1.25 +
      (u.cache_read_input_tokens ?? 0) * 3 * 0.1 +
      (u.output_tokens ?? 0) * 15) /
    1_000_000;
  return inUsd * USD_TO_THB;
}

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
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: stable, cache_control: { type: "ephemeral" } },
            { type: "text", text: promo, cache_control: { type: "ephemeral" } },
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
  let needsHuman: boolean | null = null;
  let upsell = "";
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    msg = j.message ?? raw;
    needsHuman = j.needs_human ?? null;
    upsell = j.upsell_product ?? "";
  } catch { /* ตอบไม่เป็น JSON — เก็บ raw ไว้ดู */ }
  return { msg, needsHuman, upsell, usage: data.usage ?? {} };
}

/* ---------- ตัวรัน ---------- */

describe.runIf(RUN)("gate: ยุบสินค้าหมดในดัชนี (ยิง API จริง)", () => {
  it("เทียบคำตอบเดิม/ใหม่ 9 เคส", async () => {
    loadEnv();
    const snapPath = process.env.SNAPSHOT_PATH as string;
    const snap = JSON.parse(readFileSync(snapPath, "utf8")) as Snap;
    const products: Product[] = snap.products.map((p, i) => ({ ...p, id: p.id ?? String(i) })) as Product[];
    const enabled = products.filter((p) => p.enabled !== false && p.name.trim());

    const oldStable = legacyStable(snap, enabled);

    // ตัวแปรร่วมต่อเคส: promo/customer มาจาก builder ใหม่ (ส่วนนี้พฤติกรรมเดิม-ใหม่เหมือนกัน)
    const runVariant = async (variant: "old" | "new") => {
      const only = (process.env.GATE_CASES ?? "").split(",").filter(Boolean).map(Number);
      const picked = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
      const repeat = Number(process.env.GATE_REPEAT ?? 1);
      const cases = picked.flatMap((c) => Array.from({ length: repeat }, () => c));
      const rows: { id: number; msg: string; needsHuman: boolean | null; upsell: string; thb: number }[] = [];
      let thb = 0;
      for (const c of cases) {
        const parts = buildUserContentParts({
          shopName: snap.shopName, shopVoice: snap.shopVoice, shopMemory: snap.shopMemory,
          products, customerMsg: c.q, promotions: [],
        });
        const stable = variant === "new" ? parts.stable : oldStable;
        const system = variant === "new" ? REPLY_SYSTEM_PROMPT : LEGACY_SYSTEM;
        const r = await ask(system, stable, parts.promo, parts.customer);
        const cost = costTHB(r.usage);
        thb += cost;
        rows.push({ id: c.id, msg: r.msg, needsHuman: r.needsHuman, upsell: r.upsell, thb: cost });
        console.log(`[${variant}] เคส ${c.id} เสร็จ (฿${cost.toFixed(2)})`);
      }
      return { rows, thb };
    };

    // แบบเดิม/ใหม่รันขนานกัน (คนละแคช) แต่ในแต่ละแบบยิงทีละเคสให้แคชอุ่นต่อเนื่อง
    // รันซ้ำบางส่วนได้: GATE_CASES="1,6,8" เลือกเคส, GATE_VARIANT="new" ข้ามฝั่งเดิม
    const [oldRun, newRun] = await Promise.all([
      process.env.GATE_VARIANT === "new" ? Promise.resolve({ rows: [], thb: 0 }) : runVariant("old"),
      runVariant("new"),
    ]);

    const sizeNote = (() => {
      const parts = buildUserContentParts({
        shopName: snap.shopName, shopVoice: snap.shopVoice, shopMemory: snap.shopMemory,
        products, customerMsg: "x", promotions: [],
      });
      return `ขนาด stable เดิม ${oldStable.length.toLocaleString()} ตัวอักษร → ใหม่ ${parts.stable.length.toLocaleString()} ตัวอักษร (ลด ${(100 - (parts.stable.length / oldStable.length) * 100).toFixed(1)}%)`;
    })();

    const md: string[] = [
      `# ผลด่านทดสอบ: ยุบสินค้าหมดในดัชนี (${MODEL})`, "",
      `- ${sizeNote}`,
      `- ต้นทุนเทส: เดิม ฿${oldRun.thb.toFixed(2)} + ใหม่ ฿${newRun.thb.toFixed(2)} = ฿${(oldRun.thb + newRun.thb).toFixed(2)}`, "",
    ];
    for (const c of CASES) {
      const os = oldRun.rows.filter((r) => r.id === c.id);
      const ns = newRun.rows.filter((r) => r.id === c.id);
      if (!os.length && !ns.length) continue;
      md.push(`## เคส ${c.id}: ${c.q}`, `**คาดหวัง:** ${c.expect}`, "");
      os.forEach((o, i) => md.push(`**เดิม #${i + 1}** (รอตอบ=${o.needsHuman} พ่วง=${o.upsell || "-"}):`, `> ${o.msg}`, ""));
      ns.forEach((n, i) => md.push(`**ใหม่ #${i + 1}** (รอตอบ=${n.needsHuman} พ่วง=${n.upsell || "-"}):`, `> ${n.msg}`, ""));
    }
    const outPath = process.env.GATE_OUT || "gate-soldout-results.md";
    writeFileSync(outPath, md.join("\n"));
    console.log(`\n${sizeNote}`);
    console.log(`ต้นทุนรวม ฿${(oldRun.thb + newRun.thb).toFixed(2)} | ผลเต็ม: ${outPath}`);
  }, 900_000);
});
