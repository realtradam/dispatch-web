import type { ChatQueuedMessage } from "@dispatch/transport-contract";
import type { AgentEvent } from "@dispatch/wire";
import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "./store.svelte";
import {
  createFakeCache,
  createFakeHistorySync,
  createFakeMetricsSync,
  createFakeTransport,
} from "./test-helpers";

const images = [
  { url: "data:image/png;base64,AAAA", mimeType: "image/png" },
  { url: "data:image/png;base64,BBBB" },
];

function fixture(batched = false) {
  const transport = createFakeTransport();
  const history = createFakeHistorySync();
  let nextId = 0;
  const scheduled: (() => void)[] = [];
  const store = createChatStore({
    conversationId: "c1",
    createRequestId: () => `r${++nextId}`,
    transport: transport.impl,
    historySync: history.impl,
    metricsSync: createFakeMetricsSync().impl,
    cache: createFakeCache().impl,
    ...(batched ? { scheduleFlush: (flush: () => void) => scheduled.push(flush) } : {}),
  });
  function ack(requestId: string | undefined = "r1", conversationId = "c1") {
    const msg: ChatQueuedMessage = {
      type: "chat.queued",
      conversationId,
      reason: "compaction",
      messageId: "q1",
      ...(requestId !== undefined ? { requestId } : {}),
    };
    store.handleDelta(msg);
  }
  function event(event: AgentEvent) {
    store.handleDelta({ type: "chat.delta", event });
  }
  function start(text?: string, turnId = "t1") {
    event({ type: "turn-start", conversationId: "c1", turnId });
    if (text !== undefined) event({ type: "user-message", conversationId: "c1", turnId, text });
  }
  return { store, transport, history, scheduled, ack, event, start };
}

describe("compaction-deferred chat.send", () => {
  it.each([
    "hello",
    "",
  ])("removes just the accepted local text/images for %j without error, retry or queue sends", (text) => {
    const f = fixture();
    f.store.send(text, images);
    expect(f.store.chunks).toHaveLength(text ? 3 : 2);
    f.ack();
    f.ack();
    expect(f.store.chunks).toEqual([]);
    expect(f.store.generating).toBe(false);
    expect(f.store.error).toBeNull();
    expect(f.transport.sent).toHaveLength(1);
    expect(f.transport.sent[0]).toMatchObject({ requestId: "r1", images, message: text });
    expect(f.transport.sentQueue).toEqual([]);
    f.store.dispose();
  });

  it("uses distinct request identities for identical sends and preserves unrelated content", () => {
    const f = fixture();
    f.start("another client's prompt");
    f.event({ type: "text-delta", conversationId: "c1", turnId: "t1", delta: "working" });
    f.store.send("identical", images);
    f.store.send("identical", images);
    expect(f.transport.sent.map((m) => m.requestId)).toEqual(["r1", "r2"]);
    f.ack("r1");
    f.ack("r1");
    expect(f.store.chunks.map((c) => c.chunk)).toEqual([
      { type: "text", text: "another client's prompt" },
      { type: "text", text: "working" },
      { type: "text", text: "identical" },
      ...images.map((i) => ({ type: "image", ...i })),
    ]);
    f.ack("r2");
    expect(f.store.chunks.map((c) => c.chunk)).toEqual([
      { type: "text", text: "another client's prompt" },
      { type: "text", text: "working" },
    ]);
    expect(f.store.generating).toBe(true);
    f.store.dispose();
  });

  it.each([
    "missing",
    "unknown",
    "wrong-conversation",
  ])("tolerates %s correlation without deleting any echo", (kind) => {
    const f = fixture();
    f.store.send("hello", images);
    f.store.handleDelta({
      type: "chat.queued",
      conversationId: kind === "wrong-conversation" ? "c2" : "c1",
      reason: "compaction",
      messageId: "q1",
      ...(kind === "missing" ? {} : { requestId: kind === "unknown" ? "r999" : "r1" }),
    });
    expect(f.store.chunks).toHaveLength(3);
    expect(f.store.error).toBeNull();
    f.store.dispose();
  });

  it.each([
    false,
    true,
  ])("preserves a live confirmed prompt before delayed ack (batched=%s)", (batched) => {
    const f = fixture(batched);
    f.store.send("hello", images);
    f.start("hello");
    f.event({ type: "text-delta", conversationId: "c1", turnId: "t1", delta: "answer" });
    f.ack();
    f.ack();
    for (const flush of f.scheduled) flush();
    expect(f.store.chunks.map((c) => c.chunk)).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "answer" },
    ]);
    expect(f.store.generating).toBe(true);
    expect(f.store.error).toBeNull();
    f.store.dispose();
  });

  it("turn-start tagging alone does not protect a still-local echo", () => {
    const f = fixture(true);
    f.store.send("hello", images);
    f.start();
    f.ack();
    expect(f.store.chunks).toEqual([]);
    expect(f.store.generating).toBe(true);
    f.event({ type: "user-message", conversationId: "c1", turnId: "t1", text: "hello" });
    for (const flush of f.scheduled) flush();
    expect(f.store.chunks.map((c) => c.chunk)).toEqual([{ type: "text", text: "hello" }]);
    f.store.dispose();
  });

  it("keeps a combined queue opening and steering; removes only the original individual echoes", () => {
    const f = fixture(true);
    f.store.send("one", images);
    f.store.send("two", images);
    f.start("one\n\ntwo");
    f.event({ type: "steering", conversationId: "c1", turnId: "t1", text: "steer" });
    f.ack("r2");
    f.ack("r1");
    expect(f.store.chunks.map((c) => c.chunk)).toEqual([
      { type: "text", text: "one\n\ntwo" },
      { type: "text", text: "steer" },
    ]);
    expect(f.store.generating).toBe(true);
    f.store.dispose();
  });

  it.each([
    "ack-first",
    "reset-first",
    "history-first",
  ])("handles epoch replacement idempotently: %s", async (order) => {
    const f = fixture();
    await f.store.load();
    f.store.send("hello", images);
    if (order === "ack-first") f.ack();
    f.history.historyEpoch = 1;
    f.history.returnChunks = [
      { seq: 1, role: "user", turnId: "t1", chunk: { type: "text", text: "hello" } },
      { seq: 2, role: "user", turnId: "t1", chunk: { type: "image", url: "/images/c1/saved.png" } },
    ];
    f.store.resync(1);
    if (order === "reset-first") f.ack();
    await vi.waitFor(() => expect(f.store.pendingSync).toBe(false));
    f.start("hello");
    const before = f.store.chunks;
    f.ack();
    f.ack();
    expect(f.store.chunks).toEqual(before);
    expect(f.store.chunks.map((c) => c.chunk)).toEqual(f.history.returnChunks.map((c) => c.chunk));
    expect(f.store.generating).toBe(true);
    expect(f.store.error).toBeNull();
    expect(f.transport.sent).toHaveLength(1);
    f.store.dispose();
  });

  it("keeps normal immediate-send text/image deduplication and authoritative history", async () => {
    const f = fixture();
    f.store.send("hello", images);
    f.start("hello");
    expect(f.store.chunks).toHaveLength(3);
    f.history.returnChunks = [
      { seq: 1, role: "user", turnId: "t1", chunk: { type: "text", text: "hello" } },
      { seq: 2, role: "user", turnId: "t1", chunk: { type: "image", url: "/images/c1/saved.png" } },
    ];
    f.event({ type: "turn-sealed", conversationId: "c1", turnId: "t1" });
    await vi.waitFor(() => expect(f.store.pendingSync).toBe(false));
    expect(f.store.chunks.map((c) => c.chunk)).toEqual(f.history.returnChunks.map((c) => c.chunk));
    expect(f.store.chunks.every((c) => !c.provisional)).toBe(true);
    expect(f.transport.sent).toHaveLength(1);
    f.store.dispose();
  });
});
