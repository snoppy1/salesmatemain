import { NextResponse } from "next/server";
import type { ImportResult } from "@/lib/types";
import {
  IMPORT_SYSTEM_PROMPT,
  buildImportContent,
  parseModelJson,
} from "@/lib/prompt";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

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

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "กรุณาวางข้อความที่จะนำเข้า" }, { status: 400 });
  }

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
        max_tokens: 4000,
        system: IMPORT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildImportContent(text) }],
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

  let result: ImportResult;
  try {
    const obj = parseModelJson(rawText) as {
      rules?: unknown[];
      products?: unknown[];
    };
    const rules = (Array.isArray(obj.rules) ? obj.rules : [])
      .map((r) => {
        const x = (r ?? {}) as Record<string, unknown>;
        return {
          trigger: asStr(x.trigger),
          partner: asStr(x.partner),
          price: asStr(x.price),
          reason: asStr(x.reason),
          promo: asStr(x.promo),
        };
      })
      .filter((r) => r.trigger || r.partner);

    const products = (Array.isArray(obj.products) ? obj.products : [])
      .map((p) => {
        const x = (p ?? {}) as Record<string, unknown>;
        return {
          name: asStr(x.name),
          description: asStr(x.description),
          price: asStr(x.price),
        };
      })
      .filter((p) => p.name);

    result = { rules, products };
  } catch {
    return NextResponse.json(
      { error: "แยกข้อมูลไม่สำเร็จ ลองจัดข้อความให้อ่านง่ายขึ้นแล้วลองใหม่" },
      { status: 502 },
    );
  }

  return NextResponse.json(result satisfies ImportResult);
}
