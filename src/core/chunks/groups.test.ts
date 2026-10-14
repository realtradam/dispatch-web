import type { Role, StepId } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { groupRenderedChunks } from "./groups";
import type { RenderedChunk } from "./types";

const text = (seq: number, role: Role, t: string): RenderedChunk => ({
  seq,
  role,
  chunk: { type: "text", text: t },
  provisional: false,
});
const call = (seq: number, id: string, stepId?: string, provisional = false): RenderedChunk => ({
  seq,
  role: "assistant",
  provisional,
  chunk: {
    type: "tool-call",
    toolCallId: id,
    toolName: `tool-${id}`,
    input: { id },
    ...(stepId !== undefined ? { stepId: stepId as StepId } : {}),
  },
});
const result = (seq: number, id: string, stepId?: string, provisional = false): RenderedChunk => ({
  seq,
  role: "tool",
  provisional,
  chunk: {
    type: "tool-result",
    toolCallId: id,
    toolName: `tool-${id}`,
    content: `result-${id}`,
    isError: false,
    ...(stepId !== undefined ? { stepId: stepId as StepId } : {}),
  },
});

function toolGroups(rows: readonly RenderedChunk[]) {
  return groupRenderedChunks(rows).map((g) => {
    if (g.kind !== "tool") throw new Error("expected a tool group");
    return g;
  });
}

describe("groupRenderedChunks", () => {
  it("returns no groups for an empty stream", () => {
    expect(groupRenderedChunks([])).toEqual([]);
  });
  it("passes non-tool chunks through unchanged and in order", () => {
    const rows = [text(1, "user", "hi"), text(2, "assistant", "hello")];
    expect(groupRenderedChunks(rows)).toEqual(rows.map((chunk) => ({ kind: "single", chunk })));
  });
  it("pairs a single call and result into one group", () => {
    const c = call(1, "a", "s1");
    const r = result(2, "a", "s1");
    expect(toolGroups([c, r])).toEqual([
      {
        kind: "tool",
        entry: { toolCallId: "a", toolName: "tool-a", call: c.chunk, result: r.chunk },
        stepId: "s1",
        provisional: false,
      },
    ]);
  });
  it("renders parallel calls independently in call order, with out-of-order results", () => {
    const groups = toolGroups([
      call(1, "a", "s1"),
      call(2, "b", "s1"),
      result(3, "b", "s1"),
      result(4, "a", "s1"),
    ]);
    expect(groups.map((g) => g.entry.toolCallId)).toEqual(["a", "b"]);
    expect(groups.map((g) => g.entry.result?.content)).toEqual(["result-a", "result-b"]);
  });
  it("pairs legacy chunks without stepId and mismatching stepIds by toolCallId", () => {
    const groups = toolGroups([
      call(1, "a"),
      result(2, "a"),
      call(3, "b", "s1"),
      result(4, "b", "s2"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.entry.result).not.toBeNull();
    expect(groups[1]?.stepId).toBe("s1");
  });
  it("keeps surrounding text at its position and absorbs results", () => {
    const groups = groupRenderedChunks([
      text(1, "assistant", "before"),
      call(2, "a", "s1"),
      text(3, "assistant", "between"),
      call(4, "b", "s1"),
      result(5, "a"),
      result(6, "b"),
      text(7, "assistant", "after"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["single", "tool", "single", "tool", "single"]);
  });
  it("keeps pending calls and orphan results", () => {
    const groups = toolGroups([call(1, "pending"), result(2, "orphan", "s2", true)]);
    expect(groups[0]?.entry.result).toBeNull();
    expect(groups[1]?.entry.call).toBeNull();
    expect(groups[1]?.entry.toolName).toBe("tool-orphan");
    expect(groups[1]?.provisional).toBe(true);
    expect(groups[1]?.stepId).toBe("s2");
  });
  it.each([
    [true, false],
    [false, true],
    [false, false],
  ])("combines call/result provisional flags (%s, %s)", (cp, rp) => {
    expect(toolGroups([call(1, "a", "s1", cp), result(2, "a", "s1", rp)])[0]?.provisional).toBe(
      cp || rp,
    );
  });
  it("prefers call provenance, falling back to result provenance", () => {
    const groups = toolGroups([
      { ...call(1, "a", "s1"), turnId: "t1" },
      { ...result(2, "a", "s2"), turnId: "t2" },
      call(3, "b"),
      { ...result(4, "b", "s3"), turnId: "t3" },
    ]);
    expect(groups.map((g) => [g.stepId, g.turnId])).toEqual([
      ["s1", "t1"],
      ["s3", "t3"],
    ]);
  });
  it("dedupes calls/results across steps, first occurrence wins", () => {
    const first = call(1, "a", "s1", true);
    const firstResult = result(4, "a", "s1");
    const groups = toolGroups([
      first,
      call(2, "a", "s2"),
      call(3, "b"),
      firstResult,
      result(5, "a", "s2"),
      result(6, "b"),
      result(7, "b"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.entry.call).toBe(first.chunk);
    expect(groups[0]?.entry.result).toBe(firstResult.chunk);
    expect(groups[0]?.provisional).toBe(true);
  });
  it("dedupes orphan results too", () => {
    expect(toolGroups([result(1, "a"), result(2, "a")])).toHaveLength(1);
  });
  it("positions a card at its call even when its result came first", () => {
    const c = call(3, "a");
    const groups = groupRenderedChunks([result(1, "a"), text(2, "assistant", "before call"), c]);
    expect(groups.map((g) => g.kind)).toEqual(["single", "tool"]);
  });
});
