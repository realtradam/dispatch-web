import type { ConversationHistoryResponse, WsServerMessage } from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import type { NamedAgent } from "@dispatch/wire";
import { describe, expect, it, vi } from "vitest";
import type { WebSocketLike } from "../adapters/ws";
import { createAppStore } from "./store.svelte";

interface FakeSocket extends WebSocketLike {
  sent: string[];
  resolveOpen(): void;
  feedServerMessage(data: WsServerMessage): void;
  feedSurfaceMessage(data: SurfaceServerMessage): void;
}

function fakeSocket(): FakeSocket {
  let onopen: (() => void) | null = null;
  let onmessage: ((ev: { data: string }) => void) | null = null;
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
      return null;
    },
    set onclose(_fn) {},
    resolveOpen() {
      onopen?.();
    },
    feedServerMessage(msg: WsServerMessage) {
      onmessage?.({ data: JSON.stringify(msg) });
    },
    feedSurfaceMessage(msg: SurfaceServerMessage) {
      onmessage?.({ data: JSON.stringify(msg) });
    },
    sent,
  };
  return ws;
}

/**
 * A fake socket that supports the close→reconnect cycle (the base `fakeSocket`
 * swallows `onclose`). The factory returns the SAME instance on every connect, so
 * `sent` accumulates and `open()` can be driven again after `closeRemote()`.
 */
interface ReconnectableSocket extends WebSocketLike {
  sent: string[];
  open(): void;
  closeRemote(): void;
}

function reconnectableSocket(): ReconnectableSocket {
  let onopen: (() => void) | null = null;
  let onmessage: ((ev: { data: string }) => void) | null = null;
  let onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  const sent: string[] = [];
  return {
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
    sent,
    open() {
      onopen?.();
    },
    closeRemote() {
      onclose?.({ code: 1006, reason: "" });
    },
  };
}

interface FakeFetchOptions {
  models?: readonly string[];
  history?: Record<string, ConversationHistoryResponse>;
  model?: string | null;
  /** Persisted Named Agents (GET /named-agents + CRUD in-memory). */
  namedAgents?: readonly NamedAgent[];
}

function fakeFetchImpl(opts?: FakeFetchOptions): typeof fetch {
  const models = opts?.models ?? ["opencode-1/deepseek-v4-flash", "openai/gpt-4o"];
  const history = opts?.history ?? {};
  // In-memory Named Agent store for the CRUD routes (the fake fetch mimics the
  // backend's /named-agents surface).
  let namedAgents: NamedAgent[] = opts?.namedAgents ? [...opts.namedAgents] : [];
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method =
      init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : typeof input !== "string" &&
            !(input instanceof URL) &&
            typeof input.body !== "undefined" &&
            "body" in input
          ? await input.clone().text()
          : null;
    if (/\/models(\?.*)?$/.test(url)) {
      return new Response(JSON.stringify({ models }), { status: 200 });
    }
    if (url.endsWith("/named-agents") && method === "GET") {
      return new Response(JSON.stringify({ namedAgents }), { status: 200 });
    }
    if (url.endsWith("/named-agents") && method === "POST") {
      const payload =
        bodyText === null
          ? null
          : (JSON.parse(bodyText) as { name?: string; model?: string } | null);
      const agent: NamedAgent = {
        id: `na-${namedAgents.length + 1}`,
        name: payload?.name ?? "",
        model: payload?.model ?? "",
      };
      namedAgents = [...namedAgents, agent];
      return new Response(JSON.stringify({ namedAgent: agent }), { status: 201 });
    }
    if (url.includes("/named-agents/") && method === "PUT") {
      const id = url.split("/named-agents/")[1] ?? "";
      const payload =
        bodyText === null
          ? null
          : (JSON.parse(bodyText) as { name?: string; model?: string } | null);
      const updated: NamedAgent = {
        id,
        name: payload?.name ?? "",
        model: payload?.model ?? "",
      };
      namedAgents = namedAgents.map((a) => (a.id === id ? updated : a));
      return new Response(JSON.stringify({ namedAgent: updated }), { status: 200 });
    }
    if (url.includes("/named-agents/") && method === "DELETE") {
      const id = url.split("/named-agents/")[1] ?? "";
      namedAgents = namedAgents.filter((a) => a.id !== id);
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    if (url.endsWith("/model")) {
      return new Response(
        JSON.stringify({
          conversationId: "ignored",
          model: opts?.model ?? null,
        }),
        { status: 200 },
      );
    }
    const body =
      history[url] ?? ({ chunks: [], latestSeq: 0 } satisfies ConversationHistoryResponse);
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

function parseSent(ws: { sent: string[] }): unknown[] {
  return ws.sent.map((s) => JSON.parse(s));
}

function createFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    key(_index: number): string | null {
      return null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function activeConversationId(store: ReturnType<typeof createAppStore>): string {
  const id = store.activeConversationId;
  expect(id).not.toBeNull();
  return id as string;
}

describe("createAppStore", () => {
  it("starts with empty catalog and no surfaces", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    expect(store.catalog).toEqual([]);
    expect(store.surfaces).toEqual([]);
    expect(store.lastError).toBeNull();

    store.dispose();
  });

  it("updates catalog when catalog message arrives", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "s1", region: "sidebar", title: "Surface One" },
        { id: "s2", region: "panel", title: "Surface Two" },
      ],
    });

    expect(store.catalog).toHaveLength(2);
    expect(store.catalog[0]?.id).toBe("s1");
    expect(store.catalog[1]?.id).toBe("s2");

    store.dispose();
  });

  it("auto-subscribes to every catalog entry when the catalog arrives", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.sent.length = 0;
    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "s1", region: "sidebar", title: "Surface One" },
        { id: "s2", region: "panel", title: "Surface Two" },
      ],
    });

    const subscribed = ws.sent
      .map((s) => JSON.parse(s))
      .filter((p) => p.type === "subscribe")
      .map((p) => p.surfaceId);
    expect(subscribed).toContain("s1");
    expect(subscribed).toContain("s2");

    store.dispose();
  });

  it("unsubscribes from entries that vanish from a new catalog", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "s1", region: "sidebar", title: "Surface One" },
        { id: "s2", region: "panel", title: "Surface Two" },
      ],
    });

    ws.sent.length = 0;
    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
    });

    const unsubscribed = ws.sent
      .map((s) => JSON.parse(s))
      .filter((p) => p.type === "unsubscribe")
      .map((p) => p.surfaceId);
    expect(unsubscribed).toContain("s2");
    expect(unsubscribed).not.toContain("s1");

    store.dispose();
  });

  it("exposes received surface specs via `surfaces`, in catalog order", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "s1", region: "sidebar", title: "Surface One" },
        { id: "s2", region: "panel", title: "Surface Two" },
      ],
    });

    // Only s1's spec has arrived: surfaces reflects what's actually received.
    ws.feedSurfaceMessage({
      type: "surface",
      spec: {
        id: "s1",
        region: "sidebar",
        title: "Surface One",
        fields: [{ kind: "stat", label: "Tokens", value: "1,234" }],
      },
    });
    expect(store.surfaces.map((s) => s.id)).toEqual(["s1"]);

    ws.feedSurfaceMessage({
      type: "surface",
      spec: { id: "s2", region: "panel", title: "Surface Two", fields: [] },
    });
    // Catalog order preserved (s1 before s2).
    expect(store.surfaces.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(store.surfaces[0]?.fields).toHaveLength(1);

    store.dispose();
  });

  it("invoke sends an invoke message", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.sent.length = 0;
    store.invoke("s1", "toggle-dark", true);

    const invokeMsg = ws.sent.find((s) => {
      const parsed = JSON.parse(s);
      return (
        parsed.type === "invoke" &&
        parsed.surfaceId === "s1" &&
        parsed.actionId === "toggle-dark" &&
        parsed.payload === true
      );
    });
    expect(invokeMsg).toBeTruthy();

    store.dispose();
  });

  it("error message updates lastError", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "error",
      message: "Something went wrong",
    });

    expect(store.lastError).not.toBeNull();
    expect(store.lastError?.message).toBe("Something went wrong");

    store.dispose();
  });

  it("dispose closes the socket", () => {
    const ws = fakeSocket();
    const closeSpy = { called: false };
    const origClose = ws.close.bind(ws);
    ws.close = () => {
      closeSpy.called = true;
      origClose();
    };

    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      conversationId: "test-conv",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.dispose();
    expect(closeSpy.called).toBe(true);
  });

  it("exposes activeChat with empty initial messages", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    expect(store.activeChat).toBeDefined();
    expect(store.activeChat.messages).toEqual([]);
    expect(store.activeChat.chunks).toEqual([]);
    expect(store.activeChat.error).toBeNull();

    store.dispose();
  });

  it("sending a message from draft creates a tab and posts chat.send", () => {
    const ws = fakeSocket();
    const storage = createFakeStorage();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws.resolveOpen();

    ws.sent.length = 0;
    store.send("hello world");

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]?.title).toBe("hello world");
    expect(store.activeConversationId).not.toBeNull();

    const msgs = parseSent(ws);
    const chatSend = msgs.find((m) => (m as { type: string }).type === "chat.send") as
      | { type: string; conversationId: string; message: string }
      | undefined;
    expect(chatSend).toBeTruthy();
    expect(chatSend?.message).toBe("hello world");

    store.dispose();
  });

  it("sending from draft forwards staged images on chat.send", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    ws.sent.length = 0;

    const images = [
      { url: "data:image/png;base64,AAAA", mimeType: "image/png" },
      { url: "https://example.com/x.jpg" },
    ];
    store.send("describe these", images);

    const msgs = parseSent(ws);
    const chatSend = msgs.find((m) => (m as { type: string }).type === "chat.send") as
      | { type: string; message: string; images?: { url: string }[] }
      | undefined;
    expect(chatSend).toBeTruthy();
    expect(chatSend?.images).toEqual(images);
    // The optimistic echo includes the image chunks.
    expect(store.activeChat.chunks.some((c) => c.chunk.type === "image")).toBe(true);

    store.dispose();
  });

  it("an incoming chat.delta renders in the transcript", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("test");
    const convId = activeConversationId(store);

    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "turn-start", conversationId: convId, turnId: "turn-1" },
    });

    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "text-delta", conversationId: convId, turnId: "turn-1", delta: "Hello " },
    });

    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "text-delta", conversationId: convId, turnId: "turn-1", delta: "world" },
    });

    expect(store.activeChat.chunks.length).toBeGreaterThan(0);
    const assistantChunks = store.activeChat.chunks.filter(
      (c) => c.role === "assistant" && c.chunk.type === "text",
    );
    expect(assistantChunks).toHaveLength(1);
    expect((assistantChunks[0]?.chunk as { type: "text"; text: string }).text).toBe("Hello world");

    store.dispose();
  });

  it("chat.error sets the chat error", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("test");
    const convId = activeConversationId(store);

    ws.feedServerMessage({
      type: "chat.error",
      conversationId: convId,
      message: "bad request",
    });

    expect(store.activeChat.error).toBe("bad request");

    store.dispose();
  });

  it("turn-sealed triggers a history fetch and synced chunks render", async () => {
    const fetchedUrls: string[] = [];
    const historyResponse: ConversationHistoryResponse = {
      chunks: [
        { seq: 1, role: "user", chunk: { type: "text", text: "hi" } },
        { seq: 2, role: "assistant", chunk: { type: "text", text: "hello!" } },
      ],
      latestSeq: 2,
    };
    const fetchImpl: typeof fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetchedUrls.push(url);
      if (/\/models(\?.*)?$/.test(url)) {
        return new Response(JSON.stringify({ models: ["opencode-1/deepseek-v4-flash"] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(historyResponse), { status: 200 });
    };

    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      httpUrl: "http://localhost:24203",
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("hi");
    const convId = activeConversationId(store);

    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "turn-start", conversationId: convId, turnId: "turn-1" },
    });

    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "turn-sealed", conversationId: convId, turnId: "turn-1" },
    });

    // `turn-sealed` triggers an async `syncTail` (cache.sinceSeq → historySync
    // → cache.commit → applyHistory). Poll for the side-effect rather than
    // guessing a fixed delay — under suite load a fixed `setTimeout` raced the
    // fetch chain and flaked here.
    await vi.waitFor(() => {
      expect(fetchedUrls.some((u) => u.includes(`/conversations/${convId}?sinceSeq=`))).toBe(true);
    });

    await vi.waitFor(() => {
      expect(store.activeChat.chunks.length).toBeGreaterThan(0);
    });

    store.dispose();
  });

  it("fetches and exposes the model catalog", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl({
        models: ["opencode-1/deepseek-v4-flash", "openai/gpt-4o", "anthropic/claude-3"],
      }),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    await new Promise((r) => setTimeout(r, 50));

    expect(store.models).toEqual([
      "opencode-1/deepseek-v4-flash",
      "openai/gpt-4o",
      "anthropic/claude-3",
    ]);

    store.dispose();
  });

  it("default model is flash", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    expect(store.activeModel).toBe("opencode-1/deepseek-v4-flash");

    store.dispose();
  });

  it("does not silently switch the active model when the selected one is absent from the catalog", async () => {
    // The catalog only has umans; the active (default/selected) OpenCode model is
    // NOT available. The FE must NOT auto-fall back to the first catalog model —
    // it keeps the selection and lets the model selector surface it as unavailable.
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl({ models: ["umans/umans-glm-5.2"] }),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    await new Promise((r) => setTimeout(r, 50));

    expect(store.models).toEqual(["umans/umans-glm-5.2"]);
    expect(store.activeModel).toBe("opencode-1/deepseek-v4-flash");

    store.dispose();
  });

  it("migrates a legacy persisted opencode/<model> tab model to opencode-1/<model>", async () => {
    const ws = fakeSocket();
    // Seed localStorage with a persisted tab whose model is the OBSOLETE
    // `opencode/deepseek-v4-flash` namespace.
    const storage = createFakeStorage();
    storage.setItem(
      "dispatch.tabs",
      JSON.stringify({
        tabs: [
          {
            conversationId: "c-legacy",
            title: "Legacy",
            model: "opencode/deepseek-v4-flash",
            workspaceId: "default",
          },
        ],
        activeConversationId: null,
      }),
    );
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws.resolveOpen();
    // After restore, the restored tab's model + the persisted store are migrated.
    const restored = store.tabs.find((t) => t.conversationId === "c-legacy");
    expect(restored?.model).toBe("opencode-1/deepseek-v4-flash");
    expect(store.activeModel).toBe("opencode-1/deepseek-v4-flash");
    // Issue 7: the migrated tab state is ACTUALLY written back to the storage
    // adapter immediately (not merely kept in memory) — a re-load is now a no-op.
    const persisted = JSON.parse(storage.getItem("dispatch.tabs") ?? "") as {
      tabs: Array<{ conversationId: string; model: string }>;
    };
    const persistedModel = persisted.tabs.find((t) => t.conversationId === "c-legacy")?.model;
    expect(persistedModel).toBe("opencode-1/deepseek-v4-flash");
    expect(persisted.tabs.some((t) => t.model.startsWith("opencode/"))).toBe(false);
    store.dispose();
  });

  it("draft: sending the first message creates a tab titled from the message", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    expect(store.tabs).toHaveLength(0);
    expect(store.activeConversationId).toBeNull();

    store.send("What is the meaning of life?");

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]?.title).toBe("What is the meaning of life?");
    expect(store.activeConversationId).toBe(store.tabs[0]?.conversationId);

    store.dispose();
  });

  it("selecting a model persists it to the backend", () => {
    const ws = fakeSocket();
    const fetchImpl = fakeFetchImpl();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("hello");
    store.selectModel("openai/gpt-4o");

    const put = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversationId: "ignored", model: "openai/gpt-4o" }), {
        status: 200,
      }),
    );
    const capturingStore = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (init?.method === "PUT" && url.endsWith("/model")) {
          put(url, init);
        }
        return fetchImpl(input, init);
      },
      localStorage: createFakeStorage(),
    });
    capturingStore.send("hello");
    capturingStore.selectModel("openai/gpt-4o");

    expect(put).toHaveBeenCalledOnce();
    const [callUrl, callInit] = put.mock.calls[0] as [string, RequestInit];
    expect(callUrl.endsWith("/model")).toBe(true);
    expect(JSON.parse(callInit.body as string)).toEqual({ model: "openai/gpt-4o" });

    store.dispose();
    capturingStore.dispose();
  });

  it("focuses a conversation with a persisted model", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl({ model: "openai/gpt-4o" }),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first message");

    // New tab opens with the default model until the persisted-model fetch resolves.
    expect(store.activeModel).toBe("opencode-1/deepseek-v4-flash");

    // Wait for the persisted model fetch to resolve.
    await vi.waitFor(() => expect(store.activeModel).toBe("openai/gpt-4o"));
    expect(store.tabs[0]?.model).toBe("openai/gpt-4o");

    store.dispose();
  });

  it("fetchOpenConversations stamps tabs with the conversation's persisted model (not the global active model)", async () => {
    const ws = fakeSocket();
    const fetchImpl: typeof fetch = async (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/models(\?.*)?$/.test(url)) {
        return new Response(JSON.stringify({ models: ["opencode-1/deepseek-v4-flash"] }), {
          status: 200,
        });
      }
      // The authoritative open-conversation list — one conversation whose
      // persisted model differs from the global activeModel.
      if (url.includes("/conversations?status=")) {
        return new Response(
          JSON.stringify({
            conversations: [
              {
                id: "conv-model",
                createdAt: 1000,
                lastActivityAt: 2000,
                title: "Model conv",
                status: "idle",
                workspaceId: "default",
                model: "openrouter/stealth/ox-alpha",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ chunks: [], latestSeq: 0 }), { status: 200 });
    };

    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    // global activeModel is the default until anything changes it
    expect(store.activeModel).toBe("opencode-1/deepseek-v4-flash");

    // fetchOpenConversations (boot reconcile) opens the conversation's tab —
    // stamped with the PERSISTED model from the list, not activeModel.
    await vi.waitFor(() => {
      const tab = store.tabs.find((t) => t.conversationId === "conv-model");
      expect(tab?.model).toBe("openrouter/stealth/ox-alpha");
    });

    store.dispose();
  });

  it("conversation.open WS message carrying a model stamps the tab with it", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    // The user stays on their current (draft) tab; the backend broadcasts
    // `conversation.open` with the conversation's persisted model.
    ws.feedServerMessage({
      type: "conversation.open",
      conversationId: "conv-ws",
      workspaceId: "default",
      model: "openrouter/stealth/ox-alpha",
    });

    await vi.waitFor(() => {
      const tab = store.tabs.find((t) => t.conversationId === "conv-ws");
      expect(tab?.model).toBe("openrouter/stealth/ox-alpha");
      expect(tab?.workspaceId).toBe("default");
    });

    store.dispose();
  });

  it("chat.delta routes to the matching tab only", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first message");
    const convId1 = activeConversationId(store);

    store.newDraft();
    store.send("second message");
    const convId2 = activeConversationId(store);

    expect(convId1).not.toBe(convId2);

    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "turn-start", conversationId: convId1, turnId: "turn-1" },
    });
    ws.feedServerMessage({
      type: "chat.delta",
      event: {
        type: "text-delta",
        conversationId: convId1,
        turnId: "turn-1",
        delta: "response to first",
      },
    });

    store.selectTab(convId1);
    const assistantChunks1 = store.activeChat.chunks.filter(
      (c) => c.role === "assistant" && c.chunk.type === "text",
    );
    expect(assistantChunks1).toHaveLength(1);
    expect((assistantChunks1[0]?.chunk as { type: "text"; text: string }).text).toBe(
      "response to first",
    );

    store.selectTab(convId2);
    const assistantChunks2 = store.activeChat.chunks.filter(
      (c) => c.role === "assistant" && c.chunk.type === "text",
    );
    expect(assistantChunks2).toEqual([]);

    store.dispose();
  });

  it("closing a tab evicts its cache and drops the tab", () => {
    const ws = fakeSocket();
    const storage = createFakeStorage();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws.resolveOpen();

    store.send("first");
    const convId = activeConversationId(store);
    expect(store.tabs).toHaveLength(1);

    store.closeTab(convId);

    expect(store.tabs).toHaveLength(0);
    expect(store.activeConversationId).toBeNull();

    store.dispose();
  });

  it("closing a tab POSTs /conversations/:id/close (abort turn + stop warming)", async () => {
    const calls: { url: string; method: string }[] = [];
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/close")) {
        return new Response(
          JSON.stringify({ conversationId: url.split("/").at(-2), abortedTurn: false }),
          { status: 200 },
        );
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first");
    const convId = activeConversationId(store);
    store.closeTab(convId);
    await Promise.resolve(); // flush the fire-and-forget fetch

    const close = calls.find((c) => c.url.endsWith(`/conversations/${convId}/close`));
    expect(close).toBeDefined();
    expect(close?.method).toBe("POST");

    store.dispose();
  });

  it("seeds reasoningEffort from GET /conversations/:id/reasoning-effort (null = never set)", async () => {
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/reasoning-effort")) {
        return new Response(JSON.stringify({ conversationId: "x", reasoningEffort: "xhigh" }), {
          status: 200,
        });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    await vi.waitFor(() => {
      expect(store.reasoningEffort).toBe("xhigh");
    });

    store.dispose();
  });

  it("setReasoningEffort PUTs the level and updates local state from the echo", async () => {
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.endsWith("/reasoning-effort") && init?.method === "PUT") {
        const sent = JSON.parse(init.body as string) as { reasoningEffort: string };
        return new Response(
          JSON.stringify({ conversationId: "x", reasoningEffort: sent.reasoningEffort }),
          { status: 200 },
        );
      }
      if (url.endsWith("/reasoning-effort")) {
        return new Response(JSON.stringify({ conversationId: "x", reasoningEffort: null }), {
          status: 200,
        });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    const result = await store.setReasoningEffort("max");
    expect(result).toEqual({ ok: true, reasoningEffort: "max" });
    expect(store.reasoningEffort).toBe("max");

    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/reasoning-effort"));
    expect(put).toBeDefined();
    // The PUT targets the workspace conversation (draft id works too) and
    // carries exactly the SetReasoningEffortRequest body.
    expect(put?.url).toContain(`/conversations/${store.currentConversationId}/`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ reasoningEffort: "max" });

    store.dispose();
  });

  it("setReasoningEffort surfaces a 400 error and leaves state unchanged", async () => {
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/reasoning-effort") && init?.method === "PUT") {
        return new Response(JSON.stringify({ error: "bad level" }), { status: 400 });
      }
      if (url.endsWith("/reasoning-effort")) {
        return new Response(JSON.stringify({ conversationId: "x", reasoningEffort: null }), {
          status: 200,
        });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    const result = await store.setReasoningEffort("max");
    expect(result).toEqual({ ok: false, error: "bad level" });
    expect(store.reasoningEffort).toBeNull();

    store.dispose();
  });

  it("seeds thinking from GET /conversations/:id/thinking (null = never set ⇒ ON)", async () => {
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/thinking")) {
        return new Response(JSON.stringify({ conversationId: "x", thinking: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    await vi.waitFor(() => {
      expect(store.thinking).toBe(false);
    });

    store.dispose();
  });

  it("treats a missing thinking endpoint (404) as 'never set' (null ⇒ ON)", async () => {
    // The thinking endpoint is PROPOSED (backend-handoff.md); until the backend
    // ships it, GET 404s and `thinking` stays null ⇒ the selector shows the
    // effort level (thinking ON, the default) — graceful, never a crash.
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/thinking")) {
        return new Response("not found", { status: 404 });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    // give the (404ing) fetch a tick to settle
    await vi.waitFor(() => {
      expect(store.reasoningEffort).not.toBe(undefined);
    });
    expect(store.thinking).toBeNull();

    store.dispose();
  });

  it("treats a SPA-fallback response (200 + text/html) as 'never set' (null ⇒ ON)", async () => {
    // In production (DISPATCH_WEB_DIR set), unknown API routes get the SPA
    // fallback: index.html with HTTP 200 + text/html. This must NOT crash
    // res.json() — it should leave `thinking` null (ON, the default).
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/thinking")) {
        return new Response("<!DOCTYPE html><html><body>SPA fallback</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    // give the (HTML) fetch a tick to settle
    await vi.waitFor(() => {
      expect(store.reasoningEffort).not.toBe(undefined);
    });
    expect(store.thinking).toBeNull();

    store.dispose();
  });

  it("setThinking PUTs the flag and updates local state from the echo", async () => {
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    const base = fakeFetchImpl();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.endsWith("/thinking") && init?.method === "PUT") {
        const sent = JSON.parse(init.body as string) as { thinking: boolean };
        return new Response(JSON.stringify({ conversationId: "x", thinking: sent.thinking }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/thinking")) {
        return new Response(JSON.stringify({ conversationId: "x", thinking: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return base(input, init);
    };
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    const result = await store.setThinking(false);
    expect(result).toEqual({ ok: true, thinking: false });
    expect(store.thinking).toBe(false);

    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/thinking"));
    expect(put).toBeDefined();
    expect(put?.url).toContain(`/conversations/${store.currentConversationId}/`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ thinking: false });

    store.dispose();
  });

  it("does NOT re-scope a scope:'global' surface on conversation switch (no churn)", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "s-global", region: "side", title: "Global", scope: "global" },
        { id: "s-conv", region: "side", title: "Scoped", scope: "conversation" },
      ],
    });

    ws.sent.length = 0;
    store.send("promote the draft"); // draft → real conversation: surfaces re-scope
    const convId = activeConversationId(store);

    const surfaceMsgs = parseSent(ws).filter(
      (p): p is { type: string; surfaceId: string; conversationId?: string } =>
        (p as { type: string }).type === "subscribe" ||
        (p as { type: string }).type === "unsubscribe",
    );
    // The conversation-scoped surface re-scopes: unsubscribe old + subscribe new id.
    expect(
      surfaceMsgs.some(
        (m) => m.type === "subscribe" && m.surfaceId === "s-conv" && m.conversationId === convId,
      ),
    ).toBe(true);
    // The global surface is untouched — no redundant unsubscribe+subscribe round trip.
    expect(surfaceMsgs.some((m) => m.surfaceId === "s-global")).toBe(false);

    store.dispose();
  });

  it("tabs persist to the injected storage and restore on a new store", () => {
    const ws = fakeSocket();
    const storage = createFakeStorage();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws.resolveOpen();

    store.send("persist me");
    const convId = store.tabs[0]?.conversationId;
    const title = store.tabs[0]?.title;
    expect(convId).toBeDefined();
    expect(title).toBeDefined();

    const raw = storage.getItem("dispatch.tabs");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.tabs[0].conversationId).toBe(convId);
    expect(parsed.tabs[0].title).toBe(title);

    const ws2 = fakeSocket();
    const store2 = createAppStore({
      socketFactory: () => ws2,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws2.resolveOpen();

    expect(store2.tabs).toHaveLength(1);
    expect(store2.tabs[0]?.conversationId).toBe(convId);
    expect(store2.tabs[0]?.title).toBe(title);
    expect(store2.activeConversationId).toBe(convId);

    store.dispose();
    store2.dispose();
  });

  it("tabs persist to globalThis.localStorage when no storage is injected", () => {
    const realLs = globalThis.localStorage;
    const memLs = createFakeStorage();
    globalThis.localStorage = memLs;
    try {
      const ws1 = fakeSocket();
      const store = createAppStore({
        socketFactory: () => ws1,
        fetchImpl: fakeFetchImpl(),
      });
      ws1.resolveOpen();

      store.send("persist via default");
      const convId = store.tabs[0]?.conversationId;
      const title = store.tabs[0]?.title;
      expect(convId).toBeDefined();
      expect(title).toBeDefined();

      const raw = globalThis.localStorage.getItem("dispatch.tabs");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed.tabs).toHaveLength(1);
      expect(parsed.tabs[0].conversationId).toBe(convId);
      expect(parsed.tabs[0].title).toBe(title);

      store.dispose();

      const ws2 = fakeSocket();
      const store2 = createAppStore({
        socketFactory: () => ws2,
        fetchImpl: fakeFetchImpl(),
      });
      ws2.resolveOpen();

      expect(store2.tabs).toHaveLength(1);
      expect(store2.tabs[0]?.conversationId).toBe(convId);
      expect(store2.tabs[0]?.title).toBe(title);
      expect(store2.activeConversationId).toBe(convId);

      store2.dispose();
    } finally {
      globalThis.localStorage = realLs;
    }
  });

  it("newDraft resets to draft mode", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first");
    expect(store.tabs).toHaveLength(1);

    store.newDraft();
    expect(store.activeConversationId).toBeNull();

    store.dispose();
  });

  it("selectTab switches active tab", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first");
    const convId1 = activeConversationId(store);

    store.newDraft();
    store.send("second");
    const convId2 = activeConversationId(store);

    store.selectTab(convId1);
    expect(store.activeConversationId).toBe(convId1);

    store.selectTab(convId2);
    expect(store.activeConversationId).toBe(convId2);

    store.dispose();
  });

  it("subscribes to chat for each restored tab on page load", () => {
    const storage = createFakeStorage();
    // First session: create a tab, then dispose.
    const ws1 = fakeSocket();
    const store1 = createAppStore({
      socketFactory: () => ws1,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws1.resolveOpen();
    store1.send("persist me");
    const convId = store1.tabs[0]?.conversationId as string;
    expect(convId).toBeDefined();
    store1.dispose();

    // Second session: the restored tab must be re-subscribed for live turns.
    const ws2 = fakeSocket();
    const store2 = createAppStore({
      socketFactory: () => ws2,
      fetchImpl: fakeFetchImpl(),
      localStorage: storage,
    });
    ws2.resolveOpen(); // flush the queued chat.subscribe

    const subscribed = parseSent(ws2)
      .filter((p) => (p as { type: string }).type === "chat.subscribe")
      .map((p) => (p as { conversationId: string }).conversationId);
    expect(subscribed).toContain(convId);

    store2.dispose();
  });

  it("unsubscribes from chat when a tab is closed", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first");
    const convId = activeConversationId(store);

    ws.sent.length = 0;
    store.closeTab(convId);

    const unsubscribed = parseSent(ws)
      .filter((p) => (p as { type: string }).type === "chat.unsubscribe")
      .map((p) => (p as { conversationId: string }).conversationId);
    expect(unsubscribed).toContain(convId);

    store.dispose();
  });

  it("re-subscribes chat (and resyncs) for every open conversation on reconnect", async () => {
    const fetchedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetchedUrls.push(url);
      if (/\/models(\?.*)?$/.test(url)) {
        return new Response(JSON.stringify({ models: ["opencode-1/deepseek-v4-flash"] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ chunks: [], latestSeq: 0 }), { status: 200 });
    };

    const ws = reconnectableSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      httpUrl: "http://localhost:24203",
      localStorage: createFakeStorage(),
    });
    ws.open();

    store.send("hi");
    const convId = activeConversationId(store);

    // Drop the connection, wait past the reconnect backoff, then re-open.
    ws.sent.length = 0;
    fetchedUrls.length = 0;
    ws.closeRemote();
    await new Promise((r) => setTimeout(r, 800));
    ws.open(); // reconnect → onReopen

    const subscribed = parseSent(ws)
      .filter((p) => (p as { type: string }).type === "chat.subscribe")
      .map((p) => (p as { conversationId: string }).conversationId);
    expect(subscribed).toContain(convId);

    // resync() pulled the tail from history for the reconnected conversation.
    await vi.waitFor(() => {
      expect(fetchedUrls.some((u) => u.includes(`/conversations/${convId}?sinceSeq=`))).toBe(true);
    });

    store.dispose();
  });

  // ── Heartbeat (workspace-scoped config + runs + watch) ───────────────────────
  //
  // The heartbeat API is a plain REST surface (not a transport-contract type),
  // so these tests fake the four endpoints + verify the store coerces the
  // untyped JSON and routes live deltas to a watch store (the run-chat modal).

  function heartbeatFetchImpl(opts?: {
    config?: Record<string, unknown>;
    runs?: Record<string, unknown>;
  }): typeof fetch {
    const base = fakeFetchImpl();
    const config = opts?.config ?? {
      enabled: true,
      systemPrompt: "sys",
      taskPrompt: "task",
      intervalMinutes: 15,
      model: "openai/gpt-4o",
      reasoningEffort: "medium",
    };
    const runs = opts?.runs ?? {
      runs: [
        {
          id: "run-1",
          conversationId: "hb-conv-1",
          triggeredAt: "2026-06-25T10:00:00Z",
          status: "running",
        },
      ],
    };
    return async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes("/heartbeat/runs") && method === "GET") {
        return new Response(JSON.stringify(runs), { status: 200 });
      }
      if (url.includes("/heartbeat/runs/") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/heartbeat") && method === "GET") {
        return new Response(JSON.stringify(config), { status: 200 });
      }
      if (url.endsWith("/heartbeat") && method === "PUT") {
        // Echo the patch merged onto the stored config so the round-trip is observable.
        const patch = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(JSON.stringify({ ...config, ...patch }), {
          status: 200,
        });
      }
      if (url.includes("/heartbeat")) {
        return new Response(JSON.stringify(config), { status: 200 });
      }
      return base(input, init);
    };
  }

  it("heartbeatConfig loads + coerces the workspace config", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: heartbeatFetchImpl(),
      localStorage: createFakeStorage(),
    });
    const result = await store.heartbeatConfig();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config).toEqual({
      enabled: true,
      inactiveOnly: true,
      systemPrompt: "sys",
      taskPrompt: "task",
      intervalMinutes: 15,
      model: "openai/gpt-4o",
      reasoningEffort: "medium",
    });
    store.dispose();
  });

  it("heartbeatConfig surfaces an HTTP error", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/heartbeat"))
          return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
        return fakeFetchImpl()(input);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.heartbeatConfig();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("nope");
    store.dispose();
  });

  it("setHeartbeatConfig PUTs a patch and returns the merged config", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        if (url.endsWith("/heartbeat") && method === "PUT") {
          calls.push({ url, method, body: JSON.parse(init?.body as string) });
        }
        return heartbeatFetchImpl()(input, init);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.setHeartbeatConfig({ enabled: false, intervalMinutes: 9999 });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ enabled: false, intervalMinutes: 9999 });
    // The store normalizes the echoed response (interval clamped to the 1–1440 range).
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.intervalMinutes).toBe(1440);
    store.dispose();
  });

  it("heartbeatRuns loads + coerces the run list", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: heartbeatFetchImpl(),
      localStorage: createFakeStorage(),
    });
    const result = await store.heartbeatRuns();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      id: "run-1",
      conversationId: "hb-conv-1",
      status: "running",
    });
    store.dispose();
  });

  it("stopHeartbeatRun POSTs the stop endpoint", async () => {
    const calls: { url: string; method: string }[] = [];
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        if (url.includes("/heartbeat/runs/") && method === "POST") {
          calls.push({ url, method });
        }
        return heartbeatFetchImpl()(input, init);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.stopHeartbeatRun("run-1");
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/heartbeat/runs/run-1/stop");
    expect(calls[0]?.method).toBe("POST");
    store.dispose();
  });

  it("watchConversation subscribes + routes live deltas to the watch store", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    // A heartbeat run's conversation that is NOT an open tab — watch it.
    const watch = store.watchConversation("hb-conv-watch");
    // A chat.subscribe was sent for the watched conversation.
    const subscribed = parseSent(ws).some(
      (p) =>
        (p as { type: string; conversationId?: string }).type === "chat.subscribe" &&
        (p as { conversationId?: string }).conversationId === "hb-conv-watch",
    );
    expect(subscribed).toBe(true);

    // Feed a live delta for the watched conversation → the watch store folds it.
    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "turn-start", conversationId: "hb-conv-watch", turnId: "t1" },
    });
    ws.feedServerMessage({
      type: "chat.delta",
      event: {
        type: "text-delta",
        conversationId: "hb-conv-watch",
        turnId: "t1",
        delta: "hello from heartbeat",
      },
    });

    await vi.waitFor(() => {
      const text = watch.chunks.find((c) => c.role === "assistant" && c.chunk.type === "text");
      expect((text?.chunk as { type: "text"; text: string } | undefined)?.text).toBe(
        "hello from heartbeat",
      );
    });
    expect(watch.generating).toBe(true);

    // Unwatch → unsubscribes (a chat.unsubscribe for this conversation is sent).
    ws.sent.length = 0;
    store.unwatchConversation("hb-conv-watch");
    const unsubscribed = parseSent(ws).some(
      (p) =>
        (p as { type: string; conversationId?: string }).type === "chat.unsubscribe" &&
        (p as { conversationId?: string }).conversationId === "hb-conv-watch",
    );
    expect(unsubscribed).toBe(true);

    store.dispose();
  });

  it("watchConversation reuses an open tab's store; unwatch is a no-op for it", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.send("first");
    const convId = activeConversationId(store);
    // The conversation is an open tab (already subscribed on send). Watching it
    // must REUSE the tab's store + subscription — so no NEW chat.subscribe is
    // sent (the watch path only subscribes when it creates an ephemeral store).
    // (Note: `store.activeChat` is a Svelte `$state` PROXY of the tab store, so a
    // reference-equality check is meaningless here — we assert behavior instead.)
    ws.sent.length = 0;
    store.watchConversation(convId);
    const subscribed = parseSent(ws).some(
      (p) =>
        (p as { type: string; conversationId?: string }).type === "chat.subscribe" &&
        (p as { conversationId?: string }).conversationId === convId,
    );
    expect(subscribed).toBe(false);

    // Unwatching a tab conversation does NOT unsubscribe (the tab keeps its stream).
    ws.sent.length = 0;
    store.unwatchConversation(convId);
    const unsubscribed = parseSent(ws).some(
      (p) => (p as { type: string }).type === "chat.unsubscribe",
    );
    expect(unsubscribed).toBe(false);

    store.dispose();
  });

  // ── Concurrency (per-provider limits + live status; GLOBAL REST surface) ─────
  //
  // The concurrency API is a plain REST surface under /concurrency (provided by
  // the `concurrency` extension). These tests fake all five endpoints + verify
  // the store coerces the untyped JSON and routes the right method/URL.

  function concurrencyFetchImpl(opts?: {
    limits?: Record<string, unknown>;
    limit?: Record<string, unknown>;
    status?: Record<string, unknown>;
  }): typeof fetch {
    const base = fakeFetchImpl();
    const limits = opts?.limits ?? {
      limits: [
        { providerId: "umans", limit: 4 },
        { providerId: "opencode-1", limit: 5 },
      ],
    };
    const limit = opts?.limit ?? { providerId: "umans", limit: 4 };
    const status = opts?.status ?? {
      providers: [
        { providerId: "umans", limit: 4, inFlight: 2, queued: 1, paused: false },
        {
          providerId: "opencode-1",
          limit: 5,
          inFlight: 5,
          queued: 3,
          paused: true,
          pausedUntil: 1_719_408_000_000,
        },
      ],
    };
    return async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.endsWith("/concurrency/status") && method === "GET") {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.endsWith("/concurrency/limits") && method === "GET") {
        return new Response(JSON.stringify(limits), { status: 200 });
      }
      if (url.includes("/concurrency/limits/") && method === "GET") {
        return new Response(JSON.stringify(limit), { status: 200 });
      }
      if (url.includes("/concurrency/limits/") && method === "PUT") {
        const seg = url.slice(
          url.lastIndexOf("/concurrency/limits/") + "/concurrency/limits/".length,
        );
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(JSON.stringify({ providerId: seg, ...body }), { status: 200 });
      }
      if (url.includes("/concurrency/limits/") && method === "DELETE") {
        return new Response(JSON.stringify({ ok: true, providerId: "umans" }), { status: 200 });
      }
      if (url.includes("/concurrency/cooldown/") && method === "GET") {
        return new Response(JSON.stringify({ providerId: "umans", cooldownMs: 350 }), {
          status: 200,
        });
      }
      if (url.includes("/concurrency/cooldown/") && method === "PUT") {
        const seg = url.slice(
          url.lastIndexOf("/concurrency/cooldown/") + "/concurrency/cooldown/".length,
        );
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(JSON.stringify({ providerId: seg, cooldownMs: body.cooldownMs ?? 0 }), {
          status: 200,
        });
      }
      return base(input, init);
    };
  }

  it("concurrencyLimits loads + coerces the limits list", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: concurrencyFetchImpl(),
      localStorage: createFakeStorage(),
    });
    const result = await store.concurrencyLimits();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.limits).toEqual([
      { providerId: "umans", limit: 4 },
      { providerId: "opencode-1", limit: 5 },
    ]);
    store.dispose();
  });

  it("concurrencyLimits tolerates a malformed/empty body (extension not loaded)", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: concurrencyFetchImpl({ limits: {} }),
      localStorage: createFakeStorage(),
    });
    const result = await store.concurrencyLimits();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.limits).toEqual([]);
    store.dispose();
  });

  it("concurrencyLimits surfaces an HTTP error", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/concurrency/limits"))
          return new Response(JSON.stringify({ error: "Concurrency service not available" }), {
            status: 503,
          });
        return fakeFetchImpl()(input);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.concurrencyLimits();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Concurrency service not available");
    store.dispose();
  });

  it("getConcurrencyLimit loads one provider's limit", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: concurrencyFetchImpl(),
      localStorage: createFakeStorage(),
    });
    const result = await store.getConcurrencyLimit("umans");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("umans");
    expect(result.limit).toBe(4);
    store.dispose();
  });

  it("getConcurrencyLimit surfaces a 404 (not configured)", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        if (url.includes("/concurrency/limits/") && method === "GET")
          return new Response(
            JSON.stringify({ error: "No concurrency limit configured for this provider" }),
            { status: 404 },
          );
        return fakeFetchImpl()(input);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.getConcurrencyLimit("anthropic");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("No concurrency limit configured");
    store.dispose();
  });

  it("setConcurrencyLimit PUTs { limit } to the provider URL and returns the echoed limit", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        if (url.includes("/concurrency/limits/") && method === "PUT") {
          calls.push({ url, method, body: JSON.parse(init?.body as string) });
        }
        return concurrencyFetchImpl()(input, init);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.setConcurrencyLimit("anthropic", 8);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/concurrency/limits/anthropic");
    expect(calls[0]?.body).toEqual({ limit: 8 });
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("anthropic"); // echoed by the fake
    expect(result.limit).toBe(8);
    store.dispose();
  });

  it("setConcurrencyLimit surfaces a 400 (non-positive body)", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/concurrency/limits/") && init?.method === "PUT")
          return new Response(
            JSON.stringify({ error: "Body must be { limit: <positive integer> }" }),
            {
              status: 400,
            },
          );
        return fakeFetchImpl()(input);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.setConcurrencyLimit("umans", 0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Body must be");
    store.dispose();
  });

  it("deleteConcurrencyLimit DELETEs the provider URL and returns ok", async () => {
    const calls: { url: string; method: string }[] = [];
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        if (url.includes("/concurrency/limits/") && method === "DELETE") {
          calls.push({ url, method });
        }
        return concurrencyFetchImpl()(input, init);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.deleteConcurrencyLimit("umans");
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/concurrency/limits/umans");
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("umans");
    store.dispose();
  });

  it("concurrencyStatus loads + coerces the status list (incl. pausedUntil)", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: concurrencyFetchImpl(),
      localStorage: createFakeStorage(),
    });
    const result = await store.concurrencyStatus();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providers).toHaveLength(2);
    expect(result.providers[0]).toEqual({
      providerId: "umans",
      limit: 4,
      inFlight: 2,
      queued: 1,
      paused: false,
      cooldownMs: 350,
      autoReduced: false,
    });
    expect(result.providers[1]).toMatchObject({
      providerId: "opencode-1",
      paused: true,
      pausedUntil: 1_719_408_000_000,
      cooldownMs: 350,
      autoReduced: false,
    });
    store.dispose();
  });

  it("concurrencyStatus tolerates a malformed body (extension not loaded)", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: concurrencyFetchImpl({ status: {} }),
      localStorage: createFakeStorage(),
    });
    const result = await store.concurrencyStatus();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providers).toEqual([]);
    store.dispose();
  });

  it("getConcurrencyCooldown loads + coerces the cooldown", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: concurrencyFetchImpl(),
      localStorage: createFakeStorage(),
    });
    const result = await store.getConcurrencyCooldown("umans");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("umans");
    expect(result.cooldownMs).toBe(350);
    store.dispose();
  });

  it("getConcurrencyCooldown surfaces a 404 (no concurrency config) as ok:false", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/concurrency/cooldown/")) {
          return new Response(
            JSON.stringify({ error: "No concurrency configuration for this provider" }),
            {
              status: 404,
            },
          );
        }
        return fakeFetchImpl()(input);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.getConcurrencyCooldown("ghost");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("No concurrency configuration");
    store.dispose();
  });

  it("setConcurrencyCooldown PUTs { cooldownMs } + returns the echoed value", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
        if (url.includes("/concurrency/cooldown/") && method === "PUT") {
          const body = init?.body ? JSON.parse(init.body as string) : {};
          return new Response(
            JSON.stringify({ providerId: "umans", cooldownMs: body.cooldownMs }),
            { status: 200 },
          );
        }
        return fakeFetchImpl()(input, init);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.setConcurrencyCooldown("umans", 500);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.cooldownMs).toBe(500);
    const cooldownCall = calls.find(
      (c) => c.url.includes("/concurrency/cooldown/") && c.method === "PUT",
    );
    expect(cooldownCall?.url).toContain("/concurrency/cooldown/umans");
    expect(cooldownCall?.body).toEqual({ cooldownMs: 500 });
    store.dispose();
  });

  it("setConcurrencyCooldown surfaces a 400 (invalid body) as ok:false", async () => {
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/concurrency/cooldown/") && init?.method === "PUT") {
          return new Response(
            JSON.stringify({ error: "Body must be { cooldownMs: <non-negative integer> }" }),
            { status: 400 },
          );
        }
        return fakeFetchImpl()(input, init);
      },
      localStorage: createFakeStorage(),
    });
    const result = await store.setConcurrencyCooldown("umans", -1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("non-negative integer");
    store.dispose();
  });

  // ── Conversation status: `queued` (CR-13 — waiting for a concurrency slot) ────

  it("conversation.statusChanged 'queued' sets the status (tab spinner) without opening a duplicate tab", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    store.send("hello");
    const convId = activeConversationId(store);
    const tabsBefore = store.tabs.length;

    // The backend broadcasts "queued" while the turn waits for a slot.
    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "queued",
      workspaceId: "default",
    });

    expect(store.conversationStatus(convId)).toBe("queued");
    // The tab already exists (opened on send) — no duplicate tab is opened.
    expect(store.tabs.length).toBe(tabsBefore);

    // Granted → "active" (dots), then idle on turn seal.
    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "active",
      workspaceId: "default",
    });
    expect(store.conversationStatus(convId)).toBe("active");
    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "idle",
      workspaceId: "default",
    });
    expect(store.conversationStatus(convId)).toBe("idle");
    store.dispose();
  });

  it("conversation.statusChanged 'queued' opens a tab for a new cross-device conversation", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    expect(store.tabs.length).toBe(0);

    // Another device's turn is waiting for a slot — broadcast "queued".
    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: "other-device-conv",
      status: "queued",
      workspaceId: "default",
    });

    expect(store.conversationStatus("other-device-conv")).toBe("queued");
    // A queued conversation we had no tab for opens one (like `active`).
    expect(store.tabs.some((t) => t.conversationId === "other-device-conv")).toBe(true);
    store.dispose();
  });

  // ── workspaceHasActiveConversations (workspace-card active indicator) ─────

  it("workspaceHasActiveConversations is false when no conversation is active", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    store.send("hello");
    const convId = activeConversationId(store);

    // The conversation is freshly created — the backend hasn't reported it as
    // active yet, so the workspace has no active conversation.
    expect(store.conversationStatus(convId)).toBeUndefined();
    expect(store.workspaceHasActiveConversations("default")).toBe(false);
    store.dispose();
  });

  it("workspaceHasActiveConversations is true when a conversation in the workspace is active", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    store.send("hello");
    const convId = activeConversationId(store);

    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "active",
      workspaceId: "default",
    });

    expect(store.workspaceHasActiveConversations("default")).toBe(true);
    store.dispose();
  });

  it("workspaceHasActiveConversations is true when a conversation is queued (waiting for a slot)", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    store.send("hello");
    const convId = activeConversationId(store);

    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "queued",
      workspaceId: "default",
    });

    expect(store.workspaceHasActiveConversations("default")).toBe(true);
    store.dispose();
  });

  it("workspaceHasActiveConversations goes back to false when the conversation goes idle", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    store.send("hello");
    const convId = activeConversationId(store);

    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "active",
      workspaceId: "default",
    });
    expect(store.workspaceHasActiveConversations("default")).toBe(true);

    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: convId,
      status: "idle",
      workspaceId: "default",
    });
    expect(store.workspaceHasActiveConversations("default")).toBe(false);
    store.dispose();
  });

  it("workspaceHasActiveConversations scopes to the given workspace (ignores other workspaces)", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    // A cross-device active conversation in workspace "proj-a".
    ws.feedServerMessage({
      type: "conversation.statusChanged",
      conversationId: "proj-a-conv",
      status: "active",
      workspaceId: "proj-a",
    });

    // proj-a is active; proj-b is not (no active conversation there).
    expect(store.workspaceHasActiveConversations("proj-a")).toBe(true);
    expect(store.workspaceHasActiveConversations("proj-b")).toBe(false);
    store.dispose();
  });
});

describe("createAppStore — vision settings (global)", () => {
  function visionFetch(initial: { imageLimit: number; compactionModel: string | null }): {
    fetchImpl: typeof fetch;
    puts: { imageLimit?: number; compactionModel?: string | null }[];
  } {
    let current = initial;
    const puts: { imageLimit?: number; compactionModel?: string | null }[] = [];
    return {
      puts,
      fetchImpl: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (/\/models(\?.*)?$/.test(url)) {
          return new Response(
            JSON.stringify({
              models: ["kimi/k2", "umans/glm-5.2"],
              modelInfo: { "kimi/k2": { vision: true } },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/settings/vision")) {
          if (init?.method === "PUT") {
            const text = typeof init.body === "string" ? init.body : "";
            const body = text ? (JSON.parse(text) as object) : {};
            puts.push(body as { imageLimit?: number; compactionModel?: string | null });
            current = { ...current, ...(body as object) } as {
              imageLimit: number;
              compactionModel: string | null;
            };
          }
          return new Response(JSON.stringify(current), { status: 200 });
        }
        // Default: empty history + no cwd for the other endpoints.
        return new Response(JSON.stringify({ chunks: [], latestSeq: 0 }), { status: 200 });
      },
    };
  }

  it("loads vision settings on boot (GET /settings/vision)", async () => {
    const { fetchImpl } = visionFetch({ imageLimit: 7, compactionModel: "kimi/k2" });
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl,
      localStorage: createFakeStorage(),
    });
    fakeSocket().resolveOpen(); // not strictly needed for HTTP

    await vi.waitFor(() => {
      expect(store.visionSettings).toEqual({ imageLimit: 7, compactionModel: "kimi/k2" });
    });
    store.dispose();
  });

  it("setVisionSettings PUTs a partial update and reflects the merged settings", async () => {
    const ctx = visionFetch({ imageLimit: 10, compactionModel: null });
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl: ctx.fetchImpl,
      localStorage: createFakeStorage(),
    });

    await vi.waitFor(() => {
      expect(store.visionSettings?.imageLimit).toBe(10);
    });

    const result = await store.setVisionSettings({ imageLimit: 3 });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.settings.imageLimit).toBe(3);
      expect(result.settings.compactionModel).toBeNull();
    }
    expect(ctx.puts).toEqual([{ imageLimit: 3 }]);
    expect(store.visionSettings?.imageLimit).toBe(3);

    // A second save updates compactionModel only.
    const result2 = await store.setVisionSettings({ compactionModel: "kimi/k2" });
    expect(result2?.ok).toBe(true);
    expect(ctx.puts).toEqual([{ imageLimit: 3 }, { compactionModel: "kimi/k2" }]);
    expect(store.visionSettings?.compactionModel).toBe("kimi/k2");
    store.dispose();
  });

  it("refreshVisionSettings refetches (load adapter)", async () => {
    const { fetchImpl } = visionFetch({ imageLimit: 5, compactionModel: null });
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl,
      localStorage: createFakeStorage(),
    });

    await store.refreshVisionSettings();
    expect(store.visionSettings).toEqual({ imageLimit: 5, compactionModel: null });
    store.dispose();
  });

  it("surfaces a PUT error", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/settings/vision")) {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({ error: "invalid imageLimit" }), { status: 400 });
        }
        return new Response(JSON.stringify({ imageLimit: 10, compactionModel: null }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    };
    const store = createAppStore({
      socketFactory: () => fakeSocket(),
      fetchImpl,
      localStorage: createFakeStorage(),
    });

    const result = await store.setVisionSettings({ imageLimit: -1 });
    expect(result?.ok).toBe(false);
    if (result !== null && !result.ok) {
      expect(result.error).toContain("invalid imageLimit");
    }
    store.dispose();
  });
});

describe("createAppStore — Named Agents", () => {
  it("seeds namedAgents from GET /named-agents on boot", async () => {
    const ws = fakeSocket();
    const agents: readonly NamedAgent[] = [
      { id: "na-1", name: "Coding Agent", model: "opencode-1/claude-sonnet-4.5" },
    ];
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl({ namedAgents: agents }),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    await vi.waitFor(() => expect(store.namedAgents).toEqual(agents));
    store.dispose();
  });

  it("createNamedAgent appends to the store list", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    const result = await store.createNamedAgent({ name: "Research", model: "umans/glm" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.id).toBe("na-1");
      expect(store.namedAgents).toHaveLength(1);
      expect(store.namedAgents[0]?.name).toBe("Research");
    }
    store.dispose();
  });

  it("updateNamedAgent updates the record in place", async () => {
    const ws = fakeSocket();
    const agents: readonly NamedAgent[] = [
      { id: "na-1", name: "Coding Agent", model: "opencode-1/claude-sonnet-4.5" },
    ];
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl({ namedAgents: agents }),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    const result = await store.updateNamedAgent("na-1", {
      name: "Coding",
      model: "opencode-1/new",
    });
    expect(result.ok).toBe(true);
    expect(store.namedAgents[0]?.name).toBe("Coding");
    expect(store.namedAgents[0]?.model).toBe("opencode-1/new");
    store.dispose();
  });

  it("deleteNamedAgent removes the record immediately", async () => {
    const ws = fakeSocket();
    const agents: readonly NamedAgent[] = [
      { id: "na-1", name: "Coding Agent", model: "opencode-1/claude-sonnet-4.5" },
      { id: "na-2", name: "Research Agent", model: "umans/glm" },
    ];
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl({ namedAgents: agents }),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();
    await vi.waitFor(() => expect(store.namedAgents).toHaveLength(agents.length));

    const result = await store.deleteNamedAgent("na-1");
    expect(result.ok).toBe(true);
    expect(store.namedAgents.map((a) => a.id)).toEqual(["na-2"]);
    store.dispose();
  });

  it("selectModel records a Named Agent snapshot on the active conversation", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.selectModel("opencode-1/claude-sonnet-4.5", {
      namedAgentId: "na-1",
      namedAgentName: "Coding Agent",
      model: "opencode-1/claude-sonnet-4.5",
    });

    expect(store.activeModel).toBe("opencode-1/claude-sonnet-4.5");
    expect(store.namedAgentSnapshot?.namedAgentName).toBe("Coding Agent");
    store.dispose();
  });

  it("selectModel without a snapshot clears a prior Named Agent selection", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    store.selectModel("opencode-1/claude-sonnet-4.5", {
      namedAgentId: "na-1",
      namedAgentName: "Coding Agent",
      model: "opencode-1/claude-sonnet-4.5",
    });
    store.selectModel("openai/gpt-4o");

    expect(store.activeModel).toBe("openai/gpt-4o");
    expect(store.namedAgentSnapshot).toBeNull();
    store.dispose();
  });
});
