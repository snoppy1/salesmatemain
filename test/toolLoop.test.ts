import { describe, it, expect, vi } from "vitest";
import { runToolLoop, type ModelTurn } from "@/lib/toolLoop";

describe("runToolLoop", () => {
  it("runs a requested tool then returns the final text", async () => {
    const turns: ModelTurn[] = [
      { toolUse: true, assistantContent: [{ type: "tool_use", id: "t1", name: "track_shipment", input: { orderId: "A1" } }],
        toolCalls: [{ id: "t1", name: "track_shipment", input: { orderId: "A1" } }], text: "" },
      { toolUse: false, assistantContent: [], toolCalls: [], text: '{"message":"พัสดุกำลังมาค่ะ"}' },
    ];
    const callModel = vi.fn(async () => turns.shift() as ModelTurn);
    const runTool = vi.fn(async () => "status: in_transit");

    const out = await runToolLoop({ initialContent: "ของส่งถึงไหน", callModel, runTool });

    expect(runTool).toHaveBeenCalledWith("track_shipment", { orderId: "A1" });
    expect(out).toBe('{"message":"พัสดุกำลังมาค่ะ"}');
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("stops at maxRounds and returns last text if model keeps calling tools", async () => {
    const callModel = vi.fn(async (): Promise<ModelTurn> => ({
      toolUse: true, assistantContent: [{ type: "tool_use", id: "x", name: "lookup_order", input: {} }],
      toolCalls: [{ id: "x", name: "lookup_order", input: {} }], text: "ขอเช็คก่อนนะคะ",
    }));
    const runTool = vi.fn(async () => "ok");

    const out = await runToolLoop({ initialContent: "x", callModel, runTool, maxRounds: 2 });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(out).toBe("ขอเช็คก่อนนะคะ");
  });
});
