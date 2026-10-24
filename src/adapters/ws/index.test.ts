import { describe, expect, it, vi } from "vitest";
import type { WebSocketLike } from "./index";
import { createSurfaceSocket } from "./index";

interface FakeSocket extends WebSocketLike {
  sent: string[];
  resolveOpen(): void;
  invokeMessage(data: string): void;
  invokeClose(code?: number): void;
}

function fakeSocket(): FakeSocket {
  let onopen: (() => void) | null = null;
  let onmessage: ((ev: { data: string }) => void) | null = null;
  let onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  const sent: string[] = [];

  const ws: FakeSocket = {
    send(data: string) {
      sent.push(data);
    },
    close() {},
    get onopen() {
      return onopen;
    },
    set onopen(fn) {
      onopen = fn;
    },
    get onmessage() {
      return onmessage;
    },
    set onmessage(fn) {
      onmessage = fn;
    },
    get onclose() {
      return onclose;
    },
    set onclose(fn) {
      onclose = fn;
    },
    resolveOpen() {
      onopen?.();
    },
    invokeMessage(data: string) {
      onmessage?.({ data });
    },
    invokeClose(code = 1000) {
      onclose?.({ code, reason: "" });
    },
    sent,
  };
  return ws;
}

describe("createSurfaceSocket", () => {
  it("sends queued messages once socket opens", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage,
      socketFactory: () => ws,
    });

    handle.send({ type: "subscribe", surfaceId: "s1" });
    handle.send({ type: "subscribe", surfaceId: "s2" });
    expect(ws.sent).toHaveLength(0);

    ws.resolveOpen();
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[0] ?? "")).toEqual({ type: "subscribe", surfaceId: "s1" });
    expect(JSON.parse(ws.sent[1] ?? "")).toEqual({ type: "subscribe", surfaceId: "s2" });
  });

  it("sends immediately when socket is already open", () => {
    const ws = fakeSocket();
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.sent.length = 0;

    handle.send({ type: "subscribe", surfaceId: "s1" });
    expect(ws.sent).toHaveLength(1);
  });

  it("routes inbound messages to onMessage via parseServerMessage", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.invokeMessage(JSON.stringify({ type: "catalog", catalog: [] }));
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ type: "catalog", catalog: [] });
  });

  it("drops malformed inbound messages silently", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.invokeMessage("not json");
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("auto-reconnects on close and fires onReopen after successful reconnect", () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const onMessage = vi.fn();
      const onReopen = vi.fn();
      createSurfaceSocket({
        url: "ws://test",
        onMessage,
        onReopen,
        socketFactory: () => {
          const ws = fakeSocket();
          sockets.push(ws);
          return ws;
        },
      });

      expect(sockets).toHaveLength(1);
      sockets[0]?.resolveOpen();

      // Simulate close
      sockets[0]?.invokeClose();

      // Fast-forward past the backoff delay
      vi.advanceTimersByTime(600);

      expect(sockets).toHaveLength(2);
      // onReopen should NOT have fired yet (socket not open)
      expect(onReopen).not.toHaveBeenCalled();

      sockets[1]?.resolveOpen();
      expect(onReopen).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire onReopen on initial connect", () => {
    const ws = fakeSocket();
    const onReopen = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      onReopen,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    expect(onReopen).not.toHaveBeenCalled();
  });

  it("close() prevents further reconnects", () => {
    vi.useFakeTimers();
    try {
      const sockets: ReturnType<typeof fakeSocket>[] = [];
      const handle = createSurfaceSocket({
        url: "ws://test",
        onMessage: vi.fn(),
        socketFactory: () => {
          const ws = fakeSocket();
          sockets.push(ws);
          return ws;
        },
      });

      sockets[0]?.resolveOpen();
      sockets[0]?.invokeClose();
      handle.close();

      vi.advanceTimersByTime(10_000);
      expect(sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close() prevents further sends", () => {
    const ws = fakeSocket();
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.sent.length = 0;
    handle.close();

    handle.send({ type: "subscribe", surfaceId: "s1" });
    expect(ws.sent).toHaveLength(0);
  });

  it("queues multiple sends before open and flushes in order", () => {
    const ws = fakeSocket();
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => ws,
    });

    handle.send({ type: "subscribe", surfaceId: "a" });
    handle.send({ type: "subscribe", surfaceId: "b" });
    handle.send({ type: "invoke", surfaceId: "a", actionId: "x", payload: 1 });
    ws.resolveOpen();

    expect(ws.sent).toHaveLength(3);
    expect(JSON.parse(ws.sent[0] ?? "")).toEqual({ type: "subscribe", surfaceId: "a" });
    expect(JSON.parse(ws.sent[1] ?? "")).toEqual({ type: "subscribe", surfaceId: "b" });
    expect(JSON.parse(ws.sent[2] ?? "")).toEqual({
      type: "invoke",
      surfaceId: "a",
      actionId: "x",
      payload: 1,
    });
  });

  it("routes chat.delta to onChat", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    const onChat = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      onChat,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    const event = { type: "text-delta", conversationId: "c1", turnId: "t1", delta: "hi" };
    ws.invokeMessage(JSON.stringify({ type: "chat.delta", event }));
    expect(onChat).toHaveBeenCalledOnce();
    expect(onChat).toHaveBeenCalledWith({ type: "chat.delta", event });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("routes chat.error to onChat", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    const onChat = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      onChat,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.invokeMessage(JSON.stringify({ type: "chat.error", message: "bad request" }));
    expect(onChat).toHaveBeenCalledOnce();
    expect(onChat).toHaveBeenCalledWith({ type: "chat.error", message: "bad request" });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("routes conversation.open to onConversationOpen", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    const onChat = vi.fn();
    const onConversationOpen = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      onChat,
      onConversationOpen,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.invokeMessage(
      JSON.stringify({
        type: "conversation.open",
        conversationId: "c1",
        workspaceId: "w1",
      }),
    );
    expect(onConversationOpen).toHaveBeenCalledOnce();
    expect(onConversationOpen).toHaveBeenCalledWith({
      type: "conversation.open",
      conversationId: "c1",
      workspaceId: "w1",
    });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onChat).not.toHaveBeenCalled();
  });

  it("routes conversation.statusChanged to onConversationStatusChanged", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    const onConversationStatusChanged = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      onConversationStatusChanged,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.invokeMessage(
      JSON.stringify({
        type: "conversation.statusChanged",
        conversationId: "c1",
        status: "active",
        workspaceId: "w1",
      }),
    );
    expect(onConversationStatusChanged).toHaveBeenCalledOnce();
    expect(onConversationStatusChanged).toHaveBeenCalledWith({
      type: "conversation.statusChanged",
      conversationId: "c1",
      status: "active",
      workspaceId: "w1",
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("still routes surface catalog/surface to onMessage", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    const onChat = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      onChat,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    ws.invokeMessage(JSON.stringify({ type: "catalog", catalog: [] }));
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ type: "catalog", catalog: [] });
    expect(onChat).not.toHaveBeenCalled();

    ws.invokeMessage(
      JSON.stringify({ type: "surface", spec: { id: "s1", region: "r", title: "S", fields: [] } }),
    );
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it("send accepts and serializes a chat.send message", () => {
    const ws = fakeSocket();
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    handle.send({ type: "chat.send", message: "hello" });
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0] ?? "")).toEqual({ type: "chat.send", message: "hello" });
  });

  it("onChat absent is safe (surface-only usage does not throw)", () => {
    const ws = fakeSocket();
    const onMessage = vi.fn();
    createSurfaceSocket({
      url: "ws://test",
      onMessage,
      socketFactory: () => ws,
    });

    ws.resolveOpen();
    expect(() => {
      ws.invokeMessage(
        JSON.stringify({
          type: "chat.delta",
          event: { type: "text-delta", conversationId: "c1", turnId: "t1", delta: "x" },
        }),
      );
      ws.invokeMessage(JSON.stringify({ type: "chat.error", message: "boom" }));
    }).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("chat send is queued until open then flushed", () => {
    const ws = fakeSocket();
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => ws,
    });

    handle.send({ type: "chat.send", message: "queued" });
    expect(ws.sent).toHaveLength(0);

    ws.resolveOpen();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0] ?? "")).toEqual({ type: "chat.send", message: "queued" });
  });
});

describe("reconnect backoff after open", () => {
  it.each([1013, 1006, 1011])("grows and caps delays across repeated early %s closes", (code) => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sockets: FakeSocket[] = [];
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws;
      },
    });
    try {
      for (const delay of [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const count = sockets.length;
        sockets.at(-1)?.resolveOpen();
        vi.advanceTimersByTime(100);
        sockets.at(-1)?.invokeClose(code);
        vi.advanceTimersByTime(delay - 1);
        expect(sockets).toHaveLength(count);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(count + 1);
      }
    } finally {
      handle.close();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    "healthy",
    "normal",
    "going away",
  ])("resets accumulated backoff after a %s connection", (mode) => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sockets: FakeSocket[] = [];
    const handle = createSurfaceSocket({
      url: "ws://test",
      onMessage: vi.fn(),
      socketFactory: () => {
        const ws = fakeSocket();
        sockets.push(ws);
        return ws;
      },
    });
    try {
      sockets[0]?.resolveOpen();
      sockets[0]?.invokeClose(1013);
      vi.advanceTimersByTime(500);
      sockets[1]?.resolveOpen();
      if (mode === "healthy") vi.advanceTimersByTime(30000);
      sockets[1]?.invokeClose(mode === "normal" ? 1000 : mode === "going away" ? 1001 : 1013);
      vi.advanceTimersByTime(499);
      expect(sockets).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(3);
      handle.close();
      vi.advanceTimersByTime(60000);
      expect(sockets).toHaveLength(3);
    } finally {
      handle.close();
      random.mockRestore();
      vi.useRealTimers();
    }
  });
});

it("routes chat.queued only through the typed chat callback, never surface/error handling", () => {
  const ws = fakeSocket();
  const onChat = vi.fn();
  const onMessage = vi.fn();
  const handle = createSurfaceSocket({
    url: "ws://test",
    socketFactory: () => ws,
    onChat,
    onMessage,
  });
  const ack = {
    type: "chat.queued",
    conversationId: "c1",
    reason: "compaction",
    messageId: "q1",
    requestId: "r1",
  };
  ws.invokeMessage(JSON.stringify(ack));
  expect(onChat).toHaveBeenCalledExactlyOnceWith(ack);
  expect(onMessage).not.toHaveBeenCalled();
  handle.close();
});

it("routes resync notices to chat without reconnect/resend or surface errors", () => {
  vi.useFakeTimers();
  const ws = fakeSocket();
  const onChat = vi.fn();
  const onMessage = vi.fn();
  const onReopen = vi.fn();
  const factory = vi.fn(() => ws);
  const handle = createSurfaceSocket({
    url: "ws://test",
    socketFactory: factory,
    onChat,
    onMessage,
    onReopen,
  });
  try {
    ws.resolveOpen();
    const notice = {
      type: "chat.resync-required",
      conversationId: "c1",
      turnId: "t1",
      reason: "replay-limit",
    };
    ws.invokeMessage(JSON.stringify(notice));
    ws.invokeMessage(JSON.stringify(notice));
    vi.advanceTimersByTime(1000);
    expect(onChat).toHaveBeenCalledTimes(2);
    expect(onChat).toHaveBeenCalledWith(notice);
    expect(onMessage).not.toHaveBeenCalled();
    expect(onReopen).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ws.sent).toEqual([]);
  } finally {
    handle.close();
    vi.useRealTimers();
  }
});
