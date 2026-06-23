import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { scrapeProductPage } from "@/lib/scrapeClient";
import {
  URL_IMPORT_SYSTEM_PROMPT,
  buildUrlImportContent,
  parseModelJson,
} from "@/lib/prompt";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// วางลิงก์สินค้า → ดึงหน้าเว็บ (Firecrawl/fetch) → ให้ AI สกัด ชื่อ/ราคา/รายละเอียด/รูป
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ฝั่งเซิร์ฟเวอร์" },
      { status: 500 },
    );
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "กรุณาวางลิงก์สินค้า" }, { status: 400 });
  }

  // 1) ดึงหน้าเว็บ
  let page;
  try {
    page = await scrapeProductPage(url);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "ดึงหน้าเว็บไม่สำเร็จ" },
      { status: 502 },
    );
  }

  // 2) ให้ AI สกัดข้อมูลสินค้า
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: URL_IMPORT_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildUrlImportContent(url, page.text, page.images) },
        ],
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "เชื่อมต่อ Anthropic API ไม่สำเร็จ" },
      { status: 502 },
    );
  }
  if (!anthropicRes.ok) {
    return NextResponse.json(
      { error: `Anthropic API ตอบกลับผิดพลาด (${anthropicRes.status})` },
      { status: 502 },
    );
  }

  const data = (await anthropicRes.json().catch(() => null)) as {
    content?: Array<{ type: string; text?: string }>;
  } | null;
  const rawText = data?.content?.find((c) => c.type === "text")?.text ?? "";

  try {
    const obj = parseModelJson(rawText) as { products?: unknown[] };
    const validImg = new Set(page.images); // กัน AI แต่ง URL รูปเอง
    const products = (Array.isArray(obj.products) ? obj.products : [])
      .map((p) => {
        const x = (p ?? {}) as Record<string, unknown>;
        const img = asStr(x.image);
        return {
          name: asStr(x.name),
          price: asStr(x.price),
          description: asStr(x.description),
          image: validImg.has(img) ? img : undefined,
        };
      })
      .filter((p) => p.name);

    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      { error: "อ่านข้อมูลสินค้าจากหน้าเว็บไม่สำเร็จ ลองใหม่อีกครั้ง" },
      { status: 502 },
    );
  }
}
