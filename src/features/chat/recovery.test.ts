import type {
  ChatResyncRequiredMessage,
  ConversationHistoryResponse,
} from "@dispatch/transport-contract";
import type { AgentEvent, StepId, StoredChunk, TurnEndedEvent } from "@dispatch/wire";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdbChunkStore } from "../../adapters/idb";
import { createConversationCache } from "../conversation-cache";
import type { HistorySync } from "./ports";
import { createChatStore } from "./store.svelte";
import {
  createFakeCache,
  createFakeHistorySync,
  createFakeMetricsSync,
  createFakeTransport,
} from "./test-helpers";

const step = "t1#0" as StepId;
const opening: StoredChunk = {
  seq: 1,
  role: "user",
  turnId: "t1",
  chunk: { type: "text", text: "prompt" },
};
const call: StoredChunk = {
  seq: 3,
  role: "assistant",
  turnId: "t1",
  chunk: {
    type: "tool-call",
    toolCallId: "a",
    toolName: "run_shell",
    stepId: step,
    input: { command: "full input" },
  },
};
const result: StoredChunk = {
  seq: 4,
  role: "tool",
  turnId: "t1",
  chunk: {
    type: "tool-result",
    toolCallId: "a",
    toolName: "run_shell",
    stepId: step,
    content: "full output",
    isError: false,
  },
};
const committed: StoredChunk[] = [
  opening,
  { seq: 2, role: "assistant", turnId: "t1", chunk: { type: "text", text: "complete text" } },
  call,
  result,
];

function fixture(historySync?: HistorySync, batched = false) {
  const history = createFakeHistorySync();
  const transport = createFakeTransport();
  const cache = createFakeCache();
  const scheduled: (() => void)[] = [];
  const store = createChatStore({
    conversationId: "c1",
    createRequestId: () => "r1",
    historySync: historySync ?? history.impl,
    metricsSync: createFakeMetricsSync().impl,
    cache: cache.impl,
    transport: transport.impl,
    ...(batched ? { scheduleFlush: (fn: () => void) => scheduled.push(fn) } : {}),
  });
  const event = (event: AgentEvent) => store.handleDelta({ type: "chat.delta", event });
  const notice = (
    turnId: string | undefined = "t1",
    reason: ChatResyncRequiredMessage["reason"] = "replay-limit",
  ) =>
    store.handleDelta({
      type: "chat.resync-required",
      conversationId: "c1",
      reason,
      ...(turnId !== undefined ? { turnId } : {}),
    });
  const end = (reason: TurnEndedEvent["reason"] = "sealed", turnId = "t1") =>
    event({ type: "turn-ended", conversationId: "c1", turnId, reason });
  const text = (delta: string, turnId = "t1") =>
    event({ type: "text-delta", conversationId: "c1", turnId, delta });
  return { store, history, transport, cache, scheduled, event, notice, end, text };
}

async function settled(store: ReturnType<typeof createChatStore>) {
  for (let i = 0; i < 80 && store.pendingSync; i++) await Promise.resolve();
  expect(store.pendingSync).toBe(false);
}
function response(chunks: readonly StoredChunk[], historyEpoch = 0): ConversationHistoryResponse {
  return { chunks, historyEpoch, latestSeq: chunks.at(-1)?.seq ?? 0 };
}
function deferred() {
  let resolve!: (value: ConversationHistoryResponse) => void;
  const promise = new Promise<ConversationHistoryResponse>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("omitted chat recovery", () => {
  it.each([
    false,
    true,
  ])("marks omitted replay active without content and recovers full HTTP payload (batched=%s)", async (batched) => {
    vi.useFakeTimers();
    const f = fixture(undefined, batched);
    f.text("partial");
    f.notice();
    expect(f.store.generating).toBe(true);
    expect(f.store.recovering).toBe(true);
    expect(f.store.chunks.map((r) => r.chunk)).toEqual([{ type: "text", text: "partial" }]);
    await settled(f.store);
    // No initial commit yet. A tool result follows an OMITTED call input.
    f.event({
      type: "tool-result",
      conversationId: "c1",
      turnId: "t1",
      stepId: step,
      toolCallId: "a",
      toolName: "run_shell",
      content: "short replay",
      isError: false,
    });
    f.history.returnChunks = committed;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.store.chunks.filter((r) => r.chunk.type === "tool-call")).toEqual([
      expect.objectContaining({ chunk: call.chunk, provisional: false }),
    ]);
    expect(f.store.chunks.filter((r) => r.chunk.type === "tool-result")).toHaveLength(1);
    expect(f.store.chunks.find((r) => r.chunk.type === "tool-result")?.chunk).toEqual(result.chunk);
    expect(f.store.generating).toBe(true);
    expect(f.store.error).toBeNull();
    expect(f.transport.sent).toEqual([]);
    f.store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces repeat notices and polls after step notification races persistence, without parallel requests", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      return calls === 1 ? pending.promise : response(committed);
    });
    f.notice();
    for (let i = 0; i < 20; i++) f.notice();
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(calls).toBe(1);
    f.event({ type: "step-complete", conversationId: "c1", turnId: "t1", stepId: step });
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toBe(1);
    pending.resolve(response([]));
    await settled(f.store);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect(f.store.chunks.map((r) => r.chunk)).toEqual(committed.map((r) => r.chunk));
    f.store.dispose();
  });

  it.each([
    "sealed",
    "aborted",
    "error",
    "rejected",
  ] as const)("final-syncs %s behind an in-flight fetch and preserves immediate queued carry", async (reason) => {
    vi.useFakeTimers();
    const pending = deferred();
    let calls = 0;
    const f = fixture(async () => (++calls === 1 ? pending.promise : response(committed)));
    f.notice();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    f.text("old tail");
    f.end(reason);
    f.event({ type: "user-message", conversationId: "c1", turnId: "t2", text: "queued input" });
    f.event({ type: "turn-start", conversationId: "c1", turnId: "t2" });
    f.text("carried tail", "t2");
    pending.resolve(response([opening]));
    await settled(f.store);
    expect(calls).toBe(2);
    expect(f.store.recovering).toBe(false);
    expect(f.store.generating).toBe(true);
    expect(f.store.chunks.filter((r) => r.provisional).map((r) => r.chunk)).toEqual([
      { type: "text", text: "queued input" },
      { type: "text", text: "carried tail" },
    ]);
    expect(f.store.chunks.filter((r) => r.turnId === "t1").every((r) => !r.provisional)).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(2);
    f.end("sealed", "t2");
    expect(f.store.generating).toBe(false);
    f.store.dispose();
  });

  it.each([
    false,
    true,
  ])("notice during %s-cache load requests one rerun, preserving current window", async (warm) => {
    vi.useFakeTimers();
    const pending = deferred();
    let calls = 0;
    const f = fixture(async (_id, _since, window) => {
      calls++;
      if (!warm) expect(window?.limit).toBe(192);
      return calls === 1 ? pending.promise : response([opening]);
    });
    if (warm) f.cache.store.set("c1", [opening]);
    const load = f.store.load();
    for (let i = 0; i < 15; i++) await Promise.resolve();
    f.notice();
    pending.resolve(response([opening]));
    await load;
    await settled(f.store);
    expect(calls).toBe(2);
    expect(f.store.chunks).toHaveLength(1);
    expect(f.store.recovering).toBe(true);
    expect(f.store.generating).toBe(true);
    f.store.dispose();
  });

  it("payload notice after a completed HTTP load preserves live tail, unrelated turn and tool progress", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.store.load();
    f.event({ type: "turn-start", conversationId: "c1", turnId: "other" });
    f.text("unrelated", "other");
    f.event({ type: "turn-start", conversationId: "c1", turnId: "t1" });
    f.text("partial text");
    f.event({
      type: "tool-call",
      conversationId: "c1",
      turnId: "t1",
      stepId: step,
      toolCallId: "a",
      toolName: "run_shell",
      input: { command: "short" },
    });
    f.event({
      type: "tool-result",
      conversationId: "c1",
      turnId: "t1",
      stepId: step,
      toolCallId: "a",
      toolName: "run_shell",
      content: "short",
      isError: false,
    });
    f.text("complete text"); // same payload as earlier step; NOT the same identity
    f.event({
      type: "tool-output",
      conversationId: "c1",
      turnId: "t1",
      toolCallId: "next",
      data: "progress",
      stream: "stdout",
    });
    f.history.returnChunks = committed;
    f.notice("t1", "payload-limit");
    await settled(f.store);
    expect(f.store.chunks.filter((r) => r.provisional).map((r) => r.chunk)).toEqual([
      { type: "text", text: "unrelated" },
      { type: "text", text: "complete text" },
    ]);
    expect(f.store.chunks.filter((r) => r.chunk.type === "tool-call")).toHaveLength(1);
    expect(f.store.chunks.filter((r) => r.chunk.type === "tool-result")).toHaveLength(1);
    f.store.dispose();
  });

  it("bounds epoch churn during recovery and cancels its retry timer on disposal", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const f = fixture(async () => {
      f.store.invalidateHistory(++calls);
      return response([], calls - 1);
    });
    f.notice();
    await settled(f.store);
    expect(calls).toBe(3);
    expect(f.store.error).toContain("sync paused");
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toBe(3);
    f.store.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores other conversations and disposed notices; accepts a notice without turnId", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.store.handleDelta({
      type: "chat.resync-required",
      conversationId: "other",
      reason: "payload-limit",
    });
    expect(f.store.recovering).toBe(false);
    f.store.handleDelta({
      type: "chat.resync-required",
      conversationId: "c1",
      reason: "payload-limit",
    });
    await settled(f.store);
    expect(f.store.generating).toBe(false);
    expect(f.store.recovering).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    f.event({ type: "turn-start", conversationId: "c1", turnId: "t1" });
    f.store.handleDelta({
      type: "chat.resync-required",
      conversationId: "c1",
      reason: "payload-limit",
    });
    expect(f.store.generating).toBe(true);
    expect(f.store.recovering).toBe(true);
    f.end("rejected");
    await settled(f.store);
    expect(f.store.recovering).toBe(false);
    expect(f.store.generating).toBe(false);
    f.store.dispose();
    f.notice();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("recovers a windowed rollback with real IndexedDB cache while preserving lifecycle evidence", async () => {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const cache = createConversationCache(createIdbChunkStore({ indexedDB: new IDBFactory() }));
  await cache.commit(
    "c1",
    [{ seq: 1, role: "assistant", chunk: { type: "text", text: "old epoch" } }],
    5,
  );
  const history = createFakeHistorySync();
  history.historyEpoch = 5;
  const timers = new Map<object, () => void>();
  const store = createChatStore({
    conversationId: "c1",
    createRequestId: () => "r",
    cache,
    historySync: history.impl,
    metricsSync: createFakeMetricsSync().impl,
    transport: createFakeTransport().impl,
    chatLimit: 10,
    recoveryTimer: {
      schedule(fn) {
        const key = {};
        timers.set(key, fn);
        return key;
      },
      cancel(key) {
        timers.delete(key as object);
      },
    },
  });
  try {
    await store.load();
    history.historyEpoch = 0;
    history.returnChunks = Array.from({ length: 20 }, (_, i) => ({
      seq: i + 1,
      role: "assistant" as const,
      turnId: "t1",
      chunk: { type: "text" as const, text: `restored-${i}` },
    }));
    const before = history.calls.length;
    store.handleDelta({
      type: "chat.resync-required",
      conversationId: "c1",
      turnId: "t1",
      reason: "replay-limit",
    });
    await vi.waitFor(() => expect(store.pendingSync).toBe(false));
    expect(history.calls.length - before).toBe(2);
    expect(history.calls.at(-1)).toMatchObject({ sinceSeq: 0, window: { limit: 7 } });
    expect(await cache.historyEpoch("c1")).toBe(0);
    expect(store.chunks.map((c) => c.seq)).toEqual([14, 15, 16, 17, 18, 19, 20]);
    expect(store.hasEarlier).toBe(true);
    expect(store.generating).toBe(true);
    expect(timers.size).toBe(1);
    store.handleDelta({
      type: "chat.delta",
      event: { type: "turn-ended", conversationId: "c1", turnId: "t1", reason: "aborted" },
    });
    await vi.waitFor(() => expect(store.pendingSync).toBe(false));
    expect(store.generating).toBe(false);
    expect(timers.size).toBe(0);
    expect(store.hasEarlier).toBe(true);
  } finally {
    store.dispose();
  }
});

it("ignores an unrelated terminal and stays recovering through done/seal until its actual terminal", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.notice();
  await settled(f.store);
  f.end("aborted", "unrelated");
  f.event({ type: "done", conversationId: "c1", turnId: "t1", reason: "aborted" });
  expect(f.store.recovering).toBe(true);
  expect(f.store.generating).toBe(true);
  f.event({ type: "turn-sealed", conversationId: "c1", turnId: "t1" });
  await settled(f.store);
  expect(f.store.recovering).toBe(true);
  expect(f.store.generating).toBe(true);
  f.end("aborted");
  await settled(f.store);
  expect(f.store.recovering).toBe(false);
  expect(f.store.generating).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  f.store.dispose();
});

it("makes a post-terminal request even when the terminal races the third bounded epoch attempt", async () => {
  vi.useFakeTimers();
  const third = deferred();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    if (calls < 3) {
      f.store.invalidateHistory(calls);
      return response([], calls - 1);
    }
    return calls === 3 ? third.promise : response(committed, 2);
  });
  f.notice();
  for (let i = 0; i < 60 && calls < 3; i++) await Promise.resolve();
  expect(calls).toBe(3);
  f.end("error");
  third.resolve(response([], 2));
  await settled(f.store);
  expect(calls).toBe(4);
  expect(f.store.chunks.map((r) => r.chunk)).toEqual(committed.map((r) => r.chunk));
  expect(f.store.recovering).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  f.store.dispose();
});

it("retains active recovery across a compaction epoch refresh and cancels it on reconnect/dispose", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.notice();
  await settled(f.store);
  f.history.historyEpoch = 1;
  f.store.resync(1);
  await settled(f.store);
  expect(f.store.recovering).toBe(true);
  expect(f.store.generating).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  f.store.resync();
  await settled(f.store);
  expect(f.store.recovering).toBe(false);
  expect(f.store.generating).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  f.store.dispose();
});

it("flushes a batched aborted terminal plus carried turn before applying an older HTTP response", async () => {
  vi.useFakeTimers();
  const pending = deferred();
  let calls = 0;
  const f = fixture(async () => (++calls === 1 ? pending.promise : response(committed)), true);
  f.notice();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  f.text("old partial");
  f.end("aborted");
  f.event({ type: "user-message", conversationId: "c1", turnId: "t2", text: "queued" });
  f.event({ type: "turn-start", conversationId: "c1", turnId: "t2" });
  f.text("live carried output", "t2");
  pending.resolve(response([opening]));
  await settled(f.store);
  expect(calls).toBe(2);
  expect(f.store.chunks.filter((r) => r.provisional).map((r) => r.chunk)).toEqual([
    { type: "text", text: "queued" },
    { type: "text", text: "live carried output" },
  ]);
  expect(f.store.generating).toBe(true);
  expect(f.store.recovering).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  f.store.dispose();
});

it("does not truncate a payload larger than the WS budget recovered over HTTP", async () => {
  vi.useFakeTimers();
  const large = "x".repeat(4 * 1024 * 1024 + 1);
  const full: StoredChunk[] = [
    {
      ...call,
      chunk: {
        ...call.chunk,
        type: "tool-call",
        toolCallId: "a",
        toolName: "run_shell",
        input: { command: large },
        stepId: step,
      },
    },
    {
      ...result,
      chunk: {
        type: "tool-result",
        toolCallId: "a",
        toolName: "run_shell",
        content: large,
        isError: false,
        stepId: step,
      },
    },
  ];
  const f = fixture();
  f.history.returnChunks = full;
  f.notice();
  await settled(f.store);
  expect(f.store.chunks).toHaveLength(2);
  expect(f.store.chunks.map((r) => r.chunk)).toEqual(full.map((r) => r.chunk));
  expect(f.transport.sent).toEqual([]);
  f.store.dispose();
});
