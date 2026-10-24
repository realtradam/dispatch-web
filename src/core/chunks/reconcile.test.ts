import type { AgentEvent, StepId, StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { applyHistory, foldEvent, initialState, markHistoryRecovering } from "./reducer";
import { selectChunks } from "./selectors";
import type { TranscriptState } from "./types";

const stepId = "t1#1" as StepId;
function fold(s: TranscriptState, e: AgentEvent) {
  return foldEvent(s, e);
}
const call = (toolCallId = "a", turnId = "t1", step = stepId): AgentEvent => ({
  type: "tool-call",
  conversationId: "c1",
  turnId,
  stepId: step,
  toolCallId,
  toolName: "run_shell",
  input: "partial",
});
const result = (toolCallId = "a"): AgentEvent => ({
  type: "tool-result",
  conversationId: "c1",
  turnId: "t1",
  stepId,
  toolCallId,
  toolName: "run_shell",
  content: "partial",
  isError: false,
});
const stored: StoredChunk[] = [
  { seq: 50, role: "assistant", turnId: "t1", chunk: { type: "text", text: "full" } },
  {
    seq: 51,
    role: "assistant",
    turnId: "t1",
    chunk: {
      type: "tool-call",
      stepId,
      toolCallId: "a",
      toolName: "run_shell",
      input: { command: "full" },
    },
  },
  {
    seq: 52,
    role: "tool",
    turnId: "t1",
    chunk: {
      type: "tool-result",
      stepId,
      toolCallId: "a",
      toolName: "run_shell",
      content: "full result",
      isError: false,
    },
  },
];

describe("history recovery identities", () => {
  it.each([
    "before-live",
    "after-live",
  ])("reconciles committed tool/text identity %s, not payload equality", (order) => {
    let s = markHistoryRecovering(initialState(), "t1");
    if (order === "before-live") s = applyHistory(s, stored);
    s = fold(s, { type: "text-delta", conversationId: "c1", turnId: "t1", delta: "short" });
    s = fold(s, call());
    s = fold(s, result());
    if (order === "after-live") s = applyHistory(s, stored);
    expect(selectChunks(s).map((c) => c.chunk)).toEqual(stored.map((c) => c.chunk));
    // Idempotent refresh; different step's identical text must remain live.
    s = fold(s, { type: "text-delta", conversationId: "c1", turnId: "t1", delta: "full" });
    s = applyHistory(s, stored);
    expect(selectChunks(s).at(-1)).toMatchObject({
      provisional: true,
      streaming: true,
      chunk: { type: "text", text: "full" },
    });
  });

  it("does not conflate call/result, another turn, or another step's tool identity", () => {
    let s = markHistoryRecovering(initialState(), "t1");
    s = fold(s, call("a", "other"));
    s = fold(s, call("a", "t1", "other-step" as StepId));
    s = fold(s, result("a"));
    s = applyHistory(s, stored);
    expect(s.provisional).toHaveLength(2);
    expect(s.provisional.map((p) => p.turnId)).toEqual(["other", "t1"]);
    expect(s.provisional.every((p) => p.chunk.type === "tool-call")).toBe(true);
  });

  it("terminal sync removes only that turn and keeps optimistic/unrelated/carried content", () => {
    let s = markHistoryRecovering(initialState(), "t1");
    s = fold(s, call());
    s = fold(s, { type: "turn-sealed", conversationId: "c1", turnId: "t1" });
    s = fold(s, { type: "turn-start", conversationId: "c1", turnId: "t2" });
    s = fold(s, { type: "text-delta", conversationId: "c1", turnId: "t2", delta: "queued tail" });
    s = applyHistory(s, stored, ["t1"]);
    expect(s.generating).toBe(true);
    expect(s.currentTurnId).toBe("t2");
    expect(s.accumulating?.text).toBe("queued tail");
    expect(s.historyRecoveryTurnIds).toEqual([]);
  });

  it("does not resurrect watermark-hidden history; older content stays available to Show earlier", () => {
    let s = markHistoryRecovering({ ...initialState(), hiddenBeforeSeq: 51 }, "t1");
    s = fold(s, call());
    s = applyHistory(s, stored);
    expect(s.committed.map((c) => c.seq)).toEqual([51, 52]);
    expect(s.provisional).toEqual([]);
    expect(s.hiddenBeforeSeq).toBe(51);
  });
});

it("keeps identical Stop→carry openings as distinct turn identities", () => {
  let s = markHistoryRecovering(initialState(), "t1");
  s = fold(s, { type: "user-message", conversationId: "c1", turnId: "t1", text: "same" });
  s = fold(s, { type: "turn-ended", conversationId: "c1", turnId: "t1", reason: "aborted" });
  s = fold(s, { type: "user-message", conversationId: "c1", turnId: "t2", text: "same" });
  s = fold(s, { type: "turn-start", conversationId: "c1", turnId: "t2" });
  s = applyHistory(
    s,
    [{ seq: 1, role: "user", turnId: "t1", chunk: { type: "text", text: "same" } }],
    ["t1"],
  );
  expect(selectChunks(s).map((c) => [c.turnId, c.provisional])).toEqual([
    ["t1", false],
    ["t2", true],
  ]);
  expect(s.generating).toBe(true);
});

it("reconciles steering by its completed tool batch, not repeated user text", () => {
  let s = markHistoryRecovering(initialState(), "t1");
  s = fold(s, result());
  s = fold(s, { type: "steering", conversationId: "c1", turnId: "t1", text: "short" });
  s = applyHistory(s, [
    ...stored,
    { seq: 53, role: "user", turnId: "t1", chunk: { type: "text", text: "full steering" } },
  ]);
  expect(s.provisional).toEqual([]);
  expect(selectChunks(s).at(-1)?.chunk).toEqual({ type: "text", text: "full steering" });
});
