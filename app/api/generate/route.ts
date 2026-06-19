import { NextResponse } from "next/server";
import type { GenerateRequest, GenerateResult } from "@/lib/types";
import { SYSTEM_PROMPT, buildUserContent, parseModelJson } from "@/lib/prompt";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  if (!body?.customerMsg?.trim()) {
    return NextResponse.json(
      { error: "กรุณาใส่ข้อความล่าสุดของลูกค้า" },
      { status: 400 },
    );
  }

  const userContent = buildUserContent({
    shopName: body.shopName ?? "",
    shopVoice: body.shopVoice ?? "",
    rules: Array.isArray(body.rules) ? body.rules : [],
    customerMsg: body.customerMsg ?? "",
  });

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
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "เชื่อมต่อ Anthropic API ไม่สำเร็จ" },
      { status: 502 },
    );
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Anthropic API ตอบกลับผิดพลาด (${anthropicRes.status})`, detail },
      { status: 502 },
    );
  }

  const data = (await anthropicRes.json().catch(() => null)) as {
    content?: Array<{ type: string; text?: string }>;
  } | null;

  const rawText =
    data?.content?.find((c) => c.type === "text")?.text ?? "";

  let parsed: GenerateResult;
  try {
    const obj = parseModelJson(rawText) as Record<string, unknown>;
    parsed = {
      should_upsell: Boolean(obj.should_upsell),
      message: typeof obj.message === "string" ? obj.message : "",
      reason_for_admin:
        typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
      est_added_value:
        typeof obj.est_added_value === "number" ? obj.est_added_value : null,
    };
  } catch {
    return NextResponse.json(
      { error: "อ่านคำตอบของ AI ไม่สำเร็จ" },
      { status: 502 },
    );
  }

  return NextResponse.json(parsed satisfies GenerateResult);
}
