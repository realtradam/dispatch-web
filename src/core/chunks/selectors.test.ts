import type { AgentEvent, StepId, StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { applyHistory, foldEvent, initialState, markHistoryRecovering } from "./reducer";
import { selectChunks } from "./selectors";
import { trimTranscript } from "./trim";
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

  it("de-dups the replay when the committed turn's head was unloaded (windowed/trimmed)", () => {
    // A long in-flight turn: the chat-limit window/trim unloaded the turn's
    // head (seq 1–2), so the committed run starts mid-turn while the late-join
    // replay re-delivers the WHOLE turn from its opening. Positional alignment
    // from the turn start fails at index 0; without re-anchoring, the whole
    // replay rendered as a duplicate whose tool cards collapsed onto the
    // committed ones — leaving a tail of thinking blocks with no tool calls.
    let s = trimTranscript(applyHistory(initialState(), committedStep0), 2);
    expect(s.committed.map((c) => c.seq)).toEqual([3, 4]);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), think("next")]);
    const rendered = selectChunks(s);
    expect(rendered.map((r) => [r.seq, r.chunk.type])).toEqual([
      [3, "tool-call"],
      [4, "tool-result"],
      [null, "thinking"],
    ]);
    expect(rendered[2]).toMatchObject({ streaming: true, chunk: { text: "next" } });
  });

  it("de-dups when the provisional replay starts after the committed run's head", () => {
    // Provisional trimmed past the committed head (e.g. committed restored via
    // "Show earlier" after an all-provisional overflow): re-anchor on the
    // provisional head instead.
    let s = applyHistory(initialState(), committedStep0);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), call("b", 1)]);
    s = { ...s, provisional: s.provisional.slice(2) }; // drop user + thinking
    const rendered = selectChunks(s);
    expect(rendered.map((r) => [r.seq, r.chunk.type])).toEqual([
      [1, "text"],
      [2, "thinking"],
      [3, "tool-call"],
      [4, "tool-result"],
      [null, "tool-call"],
    ]);
  });

  it("re-anchors on a persisted tool call even if the replay diverges after it", () => {
    // A toolCallId is a unique identity: everything the replay delivered before
    // it was persisted earlier in the turn (append-only), so it is unloaded
    // history — not divergent content. The divergence itself stays visible.
    let s = applyHistory(initialState(), committedStep0.slice(2));
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("OTHER")]);
    const provisional = selectChunks(s).filter((r) => r.provisional);
    expect(provisional.map((r) => r.chunk)).toMatchObject([
      { type: "tool-result", toolCallId: "OTHER" },
    ]);
  });

  it("does not re-anchor on an unverified text match (never hides divergent content)", () => {
    const committed: StoredChunk[] = [
      { seq: 7, role: "assistant", chunk: { type: "thinking", text: "plan" }, turnId: T },
      { seq: 8, role: "assistant", chunk: { type: "text", text: "persisted" }, turnId: T },
    ];
    let s = applyHistory(initialState(), committed);
    s = fold(s, [userMsg, turnStart, think("plan"), text("diverged"), call("z")]);
    // "plan" matches but the next chunk diverges: no anchor → nothing hidden.
    expect(selectChunks(s).filter((r) => r.provisional)).toHaveLength(4);
  });

  it("steps over persisted images the replay can never carry", () => {
    // A tool attached an image mid-turn: history persists it as a user image
    // chunk, but no live event carries it, so the replay lacks it.
    const image: StoredChunk = {
      seq: 5,
      role: "user",
      chunk: { type: "image", url: "/images/conv/x.png" },
      turnId: T,
    };
    const thinking: StoredChunk = {
      seq: 6,
      role: "assistant",
      chunk: { type: "thinking", text: "look" },
      turnId: T,
    };
    let s = applyHistory(initialState(), [...committedStep0, image, thinking]);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), think("look")]);
    s = fold(s, [call("b", 1)]);
    const provisional = selectChunks(s).filter((r) => r.provisional);
    expect(provisional.map((r) => r.chunk)).toMatchObject([{ type: "tool-call", toolCallId: "b" }]);
  });

  it("matches one merged thinking block against its split committed blocks (Claude)", () => {
    // Claude may return several thinking blocks in one step; history persists
    // each as its own chunk, but reasoning-deltas carry no block boundary, so
    // the replay delivers them merged into one thinking chunk.
    const split: StoredChunk[] = [
      committedStep0[0] as StoredChunk,
      { seq: 2, role: "assistant", chunk: { type: "thinking", text: "first. " }, turnId: T },
      { seq: 3, role: "assistant", chunk: { type: "thinking", text: "second." }, turnId: T },
      { ...(committedStep0[2] as StoredChunk), seq: 4 },
      { ...(committedStep0[3] as StoredChunk), seq: 5 },
    ];
    let s = applyHistory(initialState(), split);
    s = fold(s, [userMsg, turnStart, think("first. "), think("second."), call("a"), result("a")]);
    s = fold(s, [think("next")]);
    const rendered = selectChunks(s);
    expect(rendered.map((r) => [r.seq, r.chunk.type])).toEqual([
      [1, "text"],
      [2, "thinking"],
      [3, "thinking"],
      [4, "tool-call"],
      [5, "tool-result"],
      [null, "thinking"],
    ]);
  });

  it("hides an accumulating merged block once its split blocks are committed", () => {
    const split: StoredChunk[] = [
      ...committedStep0,
      { seq: 5, role: "assistant", chunk: { type: "thinking", text: "a" }, turnId: T },
      { seq: 6, role: "assistant", chunk: { type: "thinking", text: "b" }, turnId: T },
    ];
    let s = applyHistory(initialState(), split);
    s = fold(s, [userMsg, turnStart, think("plan"), call("a"), result("a"), think("ab")]);
    expect(selectChunks(s).every((r) => !r.provisional)).toBe(true);
  });

  it("re-anchors on a tool chunk when the window cut between split blocks", () => {
    // The committed head is the SECOND of two split blocks: it equals no
    // provisional chunk, so alignment anchors on the run's first tool chunk.
    const committed: StoredChunk[] = [
      { seq: 3, role: "assistant", chunk: { type: "thinking", text: "second." }, turnId: T },
      { ...(committedStep0[2] as StoredChunk), seq: 4 },
      { ...(committedStep0[3] as StoredChunk), seq: 5 },
    ];
    let s = applyHistory(initialState(), committed);
    s = fold(s, [userMsg, turnStart, think("first. second."), call("a"), result("a")]);
    s = fold(s, [call("b", 1)]);
    const provisional = selectChunks(s).filter((r) => r.provisional);
    expect(provisional.map((r) => r.chunk)).toMatchObject([{ type: "tool-call", toolCallId: "b" }]);
  });

  it("is the identity when there is no committed history", () => {
    const s = fold(initialState(), [userMsg, turnStart, text("hello")]);
    expect(selectChunks(s)).toHaveLength(2);
  });
});
