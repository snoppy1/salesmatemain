import "server-only";
import { COMPRESS_DESC_SYSTEM_PROMPT } from "./prompt";

/**
 * ย่อคำอธิบายสินค้าตอนนำเข้า: "เก็บสเปก ตัดน้ำ" (ลด token ตอน AI ตอบ โดยไม่เสียข้อมูลสำคัญ)
 * - best-effort: ถ้าพลาด/ไม่มี API key/สั้นอยู่แล้ว → คืนข้อความเดิม (ไม่ทำให้ import พัง)
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6"; // งานสกัด/ย่อ ใช้รุ่นประหยัดก็แม่นพอ

async function compressOne(desc: string): Promise<string> {
  const d = (desc ?? "").trim();
  if (d.length <= 120) return d; // สั้นอยู่แล้ว ไม่ต้องย่อ (กันยิง API ฟรีๆ)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return d;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: COMPRESS_DESC_SYSTEM_PROMPT,
        messages: [{ role: "user", content: d }],
      }),
    });
    if (!res.ok) return d;
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const txt = data.content?.find((c) => c.type === "text")?.text;
    return typeof txt === "string" && txt.trim() ? txt.trim() : d;
  } catch {
    return d;
  }
}

/** ย่อหลายตัว (ทำทีละ 6 พร้อมกัน เพื่อความเร็ว) — คืนลำดับเดิมเสมอ */
export async function compressDescriptions(descs: string[]): Promise<string[]> {
  const out = [...descs];
  const BATCH = 6;
  for (let i = 0; i < descs.length; i += BATCH) {
    const results = await Promise.all(
      descs.slice(i, i + BATCH).map((d) => compressOne(d ?? "")),
    );
    results.forEach((r, j) => {
      out[i + j] = r;
    });
  }
  return out;
}
