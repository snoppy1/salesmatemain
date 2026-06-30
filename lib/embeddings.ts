import "server-only";

/**
 * Voyage AI embeddings — ใช้ทำ semantic retrieval สินค้า (hybrid คู่กับ keyword)
 * คืน null เสมอเมื่อไม่มีคีย์/พลาด → ผู้เรียก fallback ไป keyword-only (ระบบไม่ล้ม)
 */
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5-lite"; // multilingual (ไทยโอเค) + ถูก; vector 1024 มิติ
export const EMBED_DIM = 1024;

function apiKey(): string | null {
  const k = (process.env.VOYAGE_API_KEY || "").trim();
  return k || null;
}

/** มีคีย์ embeddings ไหม (ใช้ตัดสินว่าจะใช้ hybrid หรือ keyword-only) */
export function embeddingsEnabled(): boolean {
  return apiKey() !== null;
}

async function callVoyage(
  input: string[],
  inputType: "query" | "document",
): Promise<number[][] | null> {
  const key = apiKey();
  if (!key || input.length === 0) return null;
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ input, model: MODEL, input_type: inputType }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    if (!data.data) return null;
    const out: number[][] = new Array(input.length);
    for (const d of data.data) out[d.index] = d.embedding; // เรียงตาม index ให้ตรง input
    return out;
  } catch {
    return null;
  }
}

/** embed ข้อความลูกค้า (query) — null ถ้าไม่มีคีย์/พลาด */
export async function embedQuery(text: string): Promise<number[] | null> {
  const t = (text || "").trim().slice(0, 8000);
  if (!t) return null;
  const r = await callVoyage([t], "query");
  return r?.[0] ?? null;
}

/** embed สินค้าหลายตัว (document) แบบแบตช์ — คืน array ขนานกับ texts (null = อันที่พลาด) */
export async function embedDocuments(texts: string[]): Promise<(number[] | null)[]> {
  const BATCH = 96;
  const out: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map((t) => (t || "").trim().slice(0, 8000) || " ");
    const r = await callVoyage(slice, "document");
    if (!r) for (let j = 0; j < slice.length; j++) out.push(null);
    else out.push(...r);
  }
  return out;
}

/** cosine similarity ของ 2 เวกเตอร์ */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
