export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ModelTurn = {
  toolUse: boolean;       // โมเดลขอเรียก tool ในรอบนี้ไหม
  assistantContent: unknown[]; // content blocks ของ assistant (ส่งกลับเข้า messages ตามรูปแบบ Anthropic)
  toolCalls: ToolCall[];  // tool ที่ขอเรียก
  text: string;           // ข้อความ (คำตอบสุดท้าย หรือ fallback)
};

type Message = { role: "user" | "assistant"; content: unknown };

/**
 * วนลูป tool-use ของ Anthropic แบบ pure: ฉีด callModel + runTool เข้ามา (เทสต์ได้โดยไม่ต้องต่อเน็ต)
 * - โมเดลขอ tool → รัน runTool ทุกตัว → ใส่ tool_result กลับ → วนต่อ
 * - โมเดลตอบจบ หรือครบ maxRounds → คืนข้อความสุดท้าย
 */
export async function runToolLoop(params: {
  initialContent: unknown;
  callModel: (messages: Message[]) => Promise<ModelTurn>;
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxRounds?: number;
}): Promise<string> {
  const { initialContent, callModel, runTool, maxRounds = 4 } = params;
  const messages: Message[] = [{ role: "user", content: initialContent }];
  let lastText = "";

  for (let round = 0; round < maxRounds; round++) {
    const turn = await callModel(messages);
    lastText = turn.text;
    if (!turn.toolUse || turn.toolCalls.length === 0) {
      return turn.text;
    }
    messages.push({ role: "assistant", content: turn.assistantContent });
    const results = [];
    for (const call of turn.toolCalls) {
      const result = await runTool(call.name, call.input);
      results.push({ type: "tool_result", tool_use_id: call.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }
  // ครบ maxRounds แล้วยังขอ tool อยู่ → คืนข้อความสุดท้ายที่โมเดลให้มา (กันลูปไม่จบ)
  return lastText;
}
