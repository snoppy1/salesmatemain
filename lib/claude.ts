import "server-only";
import type { GenerateRequest, GenerateResult } from "./types";
import {
  SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT,
  CHOICES_SYSTEM_PROMPT,
  buildUserContent,
  parseModelJson,
} from "./prompt";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export class ClaudeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** ผลลัพธ์การร่างคำตอบแชต (auto/draft) */
export type ReplyResult = {
  message: string;
  needsHuman: boolean;
  reason: string;
};

/** เรียก Claude แล้วคืน JSON object ที่ parse แล้ว (โยน ClaudeError ถ้าพลาด) */
async function callClaudeRaw(
  systemPrompt: string,
  req: GenerateRequest,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ฝั่งเซิร์ฟเวอร์", 500);
  }

  const userContent = buildUserContent(req);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch {
    throw new ClaudeError("เชื่อมต่อ Anthropic API ไม่สำเร็จ", 502);
  }

  if (!res.ok) {
    throw new ClaudeError(`Anthropic API ตอบกลับผิดพลาด (${res.status})`, 502);
  }

  const data = (await res.json().catch(() => null)) as {
    content?: Array<{ type: string; text?: string }>;
  } | null;
  const rawText = data?.content?.find((c) => c.type === "text")?.text ?? "";

  try {
    return parseModelJson(rawText) as Record<string, unknown>;
  } catch {
    throw new ClaudeError("อ่านคำตอบของ AI ไม่สำเร็จ", 502);
  }
}

/** หน้า "เจนประโยค": ถ้าไม่มีพ่วงที่เหมาะ message อาจว่างได้ */
export async function generateUpsell(req: GenerateRequest): Promise<GenerateResult> {
  const obj = await callClaudeRaw(SYSTEM_PROMPT, req);
  return {
    should_upsell: Boolean(obj.should_upsell),
    message: typeof obj.message === "string" ? obj.message : "",
    reason_for_admin:
      typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
    est_added_value:
      typeof obj.est_added_value === "number" ? obj.est_added_value : null,
  };
}

/** กล่องแชต LINE: ตอบลูกค้าเสมอ + ประเมิน needs_human (ใช้ทั้ง draft และ auto) */
export async function generateReply(req: GenerateRequest): Promise<ReplyResult> {
  const obj = await callClaudeRaw(REPLY_SYSTEM_PROMPT, req);
  return {
    message: typeof obj.message === "string" ? obj.message : "",
    needsHuman: Boolean(obj.needs_human),
    reason: typeof obj.reason_for_admin === "string" ? obj.reason_for_admin : "",
  };
}

/** โหมด manual: เสนอ 2-3 คำตอบให้แอดมินเลือก */
export async function generateChoices(req: GenerateRequest): Promise<string[]> {
  const obj = await callClaudeRaw(CHOICES_SYSTEM_PROMPT, req);
  const arr = Array.isArray(obj.choices) ? obj.choices : [];
  return arr
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
}
