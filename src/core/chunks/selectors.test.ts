import type { AgentEvent, StepId, StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { applyHistory, foldEvent, initialState, markHistoryRecovering } from "./reducer";
import { selectChunks } from "./selectors";
import type { TranscriptState } from "./types";

const C = "conv";
const T = "turn-1";

function fold(state: TranscriptState, events: readonly AgentEvent[]): TranscriptState {
  return events.reduce(foldEvent, state);
}

const turnStart: AgentEvent = { type: "turn-start", conversationId: C, turnId: T };
const userMsg: AgentEvent = { type: "user-message", conversationId: C, turnId: T, text: "hi" };
const think = (delta: string): AgentEvent => ({
  type: "reasoning-delta",
  conversationId: C,
  turnId: T,
  delta,
});
const text = (delta: string): AgentEvent => ({
  type: "text-delta",
  conversationId: C,
  turnId: T,
  delta,
});
const call = (id: string, step = 0): AgentEvent => ({
  type: "tool-call",
  conversationId: C,
  turnId: T,
  stepId: `${T}#${step}` as StepId,
  toolCallId: id,
  toolName: "run_shell",
  input: {},
});
const result = (id: string, step = 0): AgentEvent => ({
  type: "tool-result",
  conversationId: C,
  turnId: T,
  stepId: `${T}#${step}` as StepId,
  toolCallId: id,
  toolName: "run_shell",
  content: "ok",
  isError: false,
});

/** The persisted chunks for steps 0 (user + think + call/result). */
const committedStep0: StoredChunk[] = [
  { seq: 1, role: "user", chunk: { type: "text", text: "hi" }, turnId: T },
  { seq: 2, role: "assistant", chunk: { type: "thinking", text: "plan" }, turnId: T },
  {
    seq: 3,
    role: "assistant",
    chunk: {
      type: "tool-call",
      toolCallId: "a",
      toolName: "run_shell",
      input: {},
      stepId: `${T}#0` as StepId,
    },
    turnId: T,
  },
  {
    seq: 4,
    role: "tool",
    chunk: {
      type: "tool-result",
      toolCallId: "a",
      toolName: "run_shell",
      content: "ok",
      isError: false,
      stepId: `${T}#0` as StepId,
    },
    turnId: T,
  },
];

describe("selectChunks — de-dup of a late-join replay against committed history", () => {
  it("hides replayed provisional chunks already persisted for the in-flight turn", () => {
    // Fresh load mid-turn: history has step 0; the replay re-delivers step 0
    // and then step 1 (still streaming).
    let s = applyHistory(initialState(), committedStep0);
    s = fold(s, [
      userMsg,
      turnStart,
      think("pl"),
      think("an"),
      call("a"),
      result("a"),
      text("now"),
    ]);

    const rendered = selectChunks(s);
    expect(rendered.map((r) => [r.seq, r.chunk.type])).toEqual([
      [1, "text"],
      [2, "thinking"],
      [3, "tool-call"],
      [4, "tool-result"],
      [null, "text"],
    ]);
    expect(rendered[4]?.streaming).toBe(true);
  });

  it("keeps provisional chunks beyond the committed run", () => {
    let s = applyHistory(initialState(), committedStep0);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), call("b", 1)]);
    const rendered = selectChunks(s);
    expect(rendered).toHaveLength(5);
    expect(rendered[4]?.chunk).toMatchObject({ type: "tool-call", toolCallId: "b" });
    expect(rendered[4]?.provisional).toBe(true);
  });

  it("hides the accumulating chunk once its content is committed", () => {
    const committed: StoredChunk[] = [
      ...committedStep0,
      { seq: 5, role: "assistant", chunk: { type: "text", text: "final" }, turnId: T },
    ];
    let s = applyHistory(initialState(), committed);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), text("final")]);
    const rendered = selectChunks(s);
    expect(rendered).toHaveLength(5);
    expect(rendered.every((r) => !r.provisional)).toBe(true);
  });

  it("stops de-duping at the first mismatch (never hides divergent content)", () => {
    let s = applyHistory(initialState(), committedStep0);
    s = fold(s, [userMsg, turnStart, think("DIFFERENT"), call("a"), result("a")]);
    const rendered = selectChunks(s);
    // user echo matched (1 hidden); everything from the mismatch on is shown.
    expect(rendered.filter((r) => r.provisional)).toHaveLength(3);
  });

  it("preserves an uncommitted accumulating tail even when its text repeats history", () => {
    const committed: StoredChunk[] = [
      ...committedStep0,
      { seq: 5, role: "assistant", chunk: { type: "text", text: "final" }, turnId: T },
    ];
    let s = applyHistory(initialState(), committed);
    s = markHistoryRecovering(s, T);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), text("final")]);
    const rendered = selectChunks(s);
    expect(rendered).toHaveLength(6);
    expect(rendered.slice(0, 5).every((r) => !r.provisional)).toBe(true);
    expect(rendered[5]).toMatchObject({
      provisional: true,
      streaming: true,
      chunk: { type: "text", text: "final" },
    });
  });

  it("reconciles the same step identity even when provisional payload differs", () => {
    let s = applyHistory(initialState(), committedStep0);
    s = markHistoryRecovering(s, T);
    s = fold(s, [userMsg, turnStart, think("DIFFERENT"), call("a"), result("a")]);
    const rendered = selectChunks(s);
    // Authoritative identity wins; payload equality cannot identify omitted/truncated content.
    expect(rendered.filter((r) => r.provisional)).toHaveLength(0);
    expect(rendered.map((r) => r.chunk)).toEqual(committedStep0.map((r) => r.chunk));
  });

  it("does nothing when the committed tail belongs to another turn", () => {
    const other = committedStep0.map((c) => ({ ...c, turnId: "older" }));
    let s = applyHistory(initialState(), other);
    s = fold(s, [userMsg, turnStart, think("plan")]);
    expect(selectChunks(s).filter((r) => r.provisional)).toHaveLength(2);
  });

  it("is the identity when there is no committed history", () => {
    const s = fold(initialState(), [userMsg, turnStart, text("hello")]);
    expect(selectChunks(s)).toHaveLength(2);
  });
});
