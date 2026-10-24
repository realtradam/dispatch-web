import { describe, expect, it, vi } from "vitest";
import { createPendingInputStorage } from "./adapter/pending-inputs";
import { createChatStore } from "./store.svelte";
import {
  createFakeCache,
  createFakeHistorySync,
  createFakeMetricsSync,
  createFakeTransport,
} from "./test-helpers";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

function fixture(saved = storage(), metricsSync = createFakeMetricsSync().impl) {
  const transport = createFakeTransport();
  let id = 0;
  const store = createChatStore({
    conversationId: "c",
    createRequestId: () => `request-${++id}`,
    pendingInputStorage: createPendingInputStorage(saved, "c"),
    transport: transport.impl,
    historySync: createFakeHistorySync().impl,
    metricsSync,
    cache: createFakeCache().impl,
  });
  return { store, transport, saved };
}

const images = [{ url: "data:image/png;base64,AAAA", mimeType: "image/png" }];

describe("input delivery", () => {
  it.each([
    "send",
    "queueMessage",
  ] as const)("saves %s input through refresh without automatically retransmitting", (method) => {
    const f = fixture();
    f.store[method]("keep me", images);
    expect(f.store.pendingInputs).toHaveLength(1);
    f.store.dispose();
    const reloaded = fixture(f.saved);
    expect(reloaded.store.pendingInputs).toMatchObject([{ request: { images } }]);
    expect(JSON.stringify(reloaded.store.pendingInputs)).toContain("keep me");
    expect(reloaded.transport.sent).toEqual([]);
    expect(reloaded.transport.sentQueue).toEqual([]);
    reloaded.store.dispose();
  });

  it("streamed user echoes and wrong receipts cannot discard an unconfirmed send", () => {
    const f = fixture();
    f.store.send("mine", images);
    f.store.handleDelta({
      type: "chat.delta",
      event: { type: "user-message", conversationId: "c", turnId: "t", text: "mine" },
    });
    f.store.handleDelta({ type: "chat.accepted", conversationId: "other", requestId: "request-1" });
    f.store.handleDelta({ type: "chat.accepted", conversationId: "c", requestId: "other" });
    expect(f.store.pendingInputs).toHaveLength(1);
    f.store.handleDelta({ type: "chat.accepted", conversationId: "c", requestId: "request-1" });
    expect(f.store.pendingInputs).toEqual([]);
    expect(createPendingInputStorage(f.saved, "c").load()).toEqual([]);
    f.store.dispose();
  });

  it("retains explicitly rejected input and images for recovery until discarded", () => {
    const f = fixture();
    f.store.send("mine", images);
    f.store.handleDelta({
      type: "chat.error",
      conversationId: "c",
      requestId: "request-1",
      message: "disk full",
    });
    const reloaded = fixture(f.saved);
    expect(reloaded.store.pendingInputs).toMatchObject([
      { rejection: "disk full", request: { message: "mine", images } },
    ]);
    reloaded.store.discardPendingInput("request-1");
    expect(createPendingInputStorage(f.saved, "c").load()).toEqual([]);
    f.store.dispose();
    reloaded.store.dispose();
  });

  it.each([
    "send",
    "queueMessage",
  ] as const)("does not clear or transmit %s input if saving fails", (method) => {
    const saved = storage();
    saved.setItem = () => {
      throw new Error("quota exceeded");
    };
    const f = fixture(saved);
    expect(() => f.store[method]("mine", images)).toThrow("quota exceeded");
    expect(f.store.pendingInputs).toEqual([]);
    expect(f.store.chunks).toEqual([]);
    expect(f.transport.sent).toEqual([]);
    expect(f.transport.sentQueue).toEqual([]);
    f.store.dispose();
  });

  it("coalesces a reconnect burst and permits one metrics catch-up after completion", async () => {
    let resolve!: (value: { turns: [] }) => void;
    const first = {
      promise: new Promise<{ turns: [] }>((done) => {
        resolve = done;
      }),
      resolve: (value: { turns: [] }) => resolve(value),
    };
    const metricsSync = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ turns: [] });
    const f = fixture(storage(), metricsSync);
    for (let i = 0; i < 100; i++) f.store.resync();
    expect(metricsSync).toHaveBeenCalledTimes(1);
    first.resolve({ turns: [] });
    await vi.waitFor(() => expect(metricsSync).toHaveBeenCalledTimes(2));
    f.store.dispose();
  });
});

it("concurrent browser tabs cannot overwrite each other's saved messages or receipts", () => {
  const saved = storage();
  const first = createPendingInputStorage(saved, "c");
  const second = createPendingInputStorage(saved, "c");
  first.load();
  second.load();
  const input = (requestId: string) => ({
    request: { type: "chat.send" as const, conversationId: "c", requestId, message: requestId },
  });
  first.save([input("first")]);
  second.save([input("second")]);
  first.save([]);
  expect(createPendingInputStorage(saved, "c").load()).toEqual([input("second")]);
});
