import "server-only";
import type { GenerateRequest } from "./types";
import {
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
  const imgs = req.imageUrls ?? [];
  // มีรูป → ส่งเป็น content blocks (text + image url) ให้ Claude ดูภาพ; ไม่มีรูป → string เดิม (ไม่มีต้นทุนรูปเพิ่ม)
  const content =
    imgs.length === 0
      ? userContent
      : [
          { type: "text", text: userContent },
          ...imgs.map((url) => ({ type: "image", source: { type: "url", url } })),
        ];

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
        messages: [{ role: "user", content }],
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

/** กล่องแชต: ตอบลูกค้าเสมอ + ประเมิน needs_human (ใช้ทั้ง draft และ auto) */
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
