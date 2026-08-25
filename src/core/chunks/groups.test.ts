import type { Role, StepId } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { groupRenderedChunks } from "./groups";
import type { RenderedChunk } from "./types";

const text = (seq: number, role: Role, t: string, provisional = false): RenderedChunk => ({
  seq,
  role,
  chunk: { type: "text", text: t },
  provisional,
});

const call = (seq: number, id: string, stepId?: string, provisional = false): RenderedChunk => ({
  seq,
  role: "assistant",
  chunk: {
    type: "tool-call",
    toolCallId: id,
    toolName: `tool-${id}`,
    input: { id },
    ...(stepId !== undefined ? { stepId: stepId as StepId } : {}),
  },
  provisional,
});

const result = (seq: number, id: string, stepId?: string, provisional = false): RenderedChunk => ({
  seq,
  role: "tool",
  chunk: {
    type: "tool-result",
    toolCallId: id,
    toolName: `tool-${id}`,
    content: `result-${id}`,
    isError: false,
    ...(stepId !== undefined ? { stepId: stepId as StepId } : {}),
  },
  provisional,
});

describe("groupRenderedChunks", () => {
  it("returns no groups for an empty stream", () => {
    expect(groupRenderedChunks([])).toEqual([]);
  });

  it("passes non-tool chunks through as single groups, in order", () => {
    const groups = groupRenderedChunks([text(1, "user", "hi"), text(2, "assistant", "hello")]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
  });

  it("does NOT batch a single tool call (one per step) — call+result stay separate singles", () => {
    const groups = groupRenderedChunks([call(1, "a", "s1"), result(2, "a", "s1")]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.kind)).toEqual(["single", "single"]);
  });

  it("does NOT batch tool calls that have no stepId (pre-0.2.0 replay)", () => {
    const groups = groupRenderedChunks([
      call(1, "a"),
      call(2, "b"),
      result(3, "a"),
      result(4, "b"),
    ]);
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
  });

  it("batches 2+ calls sharing a stepId into one group, pairing each with its result", () => {
    const groups = groupRenderedChunks([
      call(1, "a", "s1"),
      call(2, "b", "s1"),
      result(3, "a", "s1"),
      result(4, "b", "s1"),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    if (g?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(g.stepId).toBe("s1");
    expect(g.entries).toHaveLength(2);
    expect(g.entries[0]?.call.toolCallId).toBe("a");
    expect(g.entries[0]?.result?.content).toBe("result-a");
    expect(g.entries[1]?.call.toolCallId).toBe("b");
    expect(g.entries[1]?.result?.content).toBe("result-b");
  });

  it("positions the batch at the first call and keeps surrounding chunks in order", () => {
    const groups = groupRenderedChunks([
      text(1, "assistant", "before"),
      call(2, "a", "s1"),
      call(3, "b", "s1"),
      result(4, "a", "s1"),
      result(5, "b", "s1"),
      text(6, "assistant", "after"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["single", "tool-batch", "single"]);
  });

  it("marks the batch provisional when any of its calls/results is provisional", () => {
    const groups = groupRenderedChunks([call(1, "a", "s1"), call(2, "b", "s1", true)]);
    const g = groups[0];
    if (g?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(g.provisional).toBe(true);
    expect(g.entries).toHaveLength(2);
    expect(g.entries[1]?.result).toBeNull(); // dangling call (no result yet)
  });

  it("batches one step while leaving a different single-call step ungrouped", () => {
    const groups = groupRenderedChunks([
      call(1, "a", "s1"),
      call(2, "b", "s1"),
      call(3, "c", "s2"),
      result(4, "a", "s1"),
      result(5, "b", "s1"),
      result(6, "c", "s2"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["tool-batch", "single", "single"]);
    const batch = groups[0];
    if (batch?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(batch.entries).toHaveLength(2);
    // the s2 single call + its result remain as separate single groups
    const singles = groups.slice(1);
    expect(singles[0]?.kind === "single" && singles[0].chunk.chunk.type).toBe("tool-call");
    expect(singles[1]?.kind === "single" && singles[1].chunk.chunk.type).toBe("tool-result");
  });

  // --- Duplicate toolCallId hardening (fix-toolcall-duplicate-keys) ---
  // A provider double-emission (e.g. openrouter/stealth/ox-alpha) can persist the
  // SAME toolCallId twice within one step. The renderer must NEVER crash on that
  // (Svelte `each_key_duplicate` aborts the reactive flush — the tab appears dead).

  it("dedupes duplicate toolCallIds within a batch", () => {
    // The PII_REDACTED_CONVERSATION_SHORT_01 pattern: every id emitted twice, in order (seq 1,2 then 3,4).
    const groups = groupRenderedChunks([
      call(1, "a", "s1"),
      call(2, "b", "s1"),
      call(3, "a", "s1"),
      call(4, "b", "s1"),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    if (g?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(g.entries).toHaveLength(2);
    expect(g.entries.map((e) => e.call.toolCallId)).toEqual(["a", "b"]);
  });

  it("dedupes duplicate toolCallIds and pairs each unique call with its result", () => {
    const groups = groupRenderedChunks([
      call(1, "a", "s1"),
      call(2, "b", "s1"),
      call(3, "a", "s1"),
      call(4, "b", "s1"),
      result(5, "a", "s1"),
      result(6, "b", "s1"),
      result(7, "a", "s1"),
      result(8, "b", "s1"),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    if (g?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(g.entries).toHaveLength(2);
    expect(g.entries[0]?.call.toolCallId).toBe("a");
    expect(g.entries[0]?.result?.content).toBe("result-a");
    expect(g.entries[1]?.call.toolCallId).toBe("b");
    expect(g.entries[1]?.result?.content).toBe("result-b");
  });

  it("keeps the first occurrence of a duplicate toolCallId and skips the second", () => {
    const firstA = call(1, "a", "s1"); // first occurrence of a
    const firstB = call(2, "b", "s1"); // first occurrence of b
    const groups = groupRenderedChunks([
      firstA,
      firstB,
      call(3, "a", "s1"), // duplicate of a — skipped
      call(4, "b", "s1"), // duplicate of b — skipped
    ]);
    const g = groups[0];
    if (g?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(g.entries).toHaveLength(2);
    // The FIRST occurrence (by stream order) is the one kept — referential
    // equality against the seq-1 / seq-2 chunks (the entry stores the inner
    // chunk; the outer `seq` lives on the RenderedChunk wrapper).
    expect(g.entries[0]?.call).toBe(firstA.chunk);
    expect(g.entries[1]?.call).toBe(firstB.chunk);
  });

  it("keeps the first (provisional) occurrence of a duplicate and marks the batch provisional", () => {
    // One provisional + one committed chunk with the SAME id: the first
    // (provisional) occurrence wins, and the batch stays provisional.
    const prov = call(1, "a", "s1", true);
    const groups = groupRenderedChunks([prov, call(2, "a", "s1")]);
    const g = groups[0];
    if (g?.kind !== "tool-batch") throw new Error("expected a tool-batch group");
    expect(g.provisional).toBe(true);
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0]?.call).toBe(prov.chunk);
    expect(g.entries[0]?.result).toBeNull();
  });
});
