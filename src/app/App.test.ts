import type { LayoutTree } from "@dispatch/layout-contract";
import { DEFAULT_LAYOUT } from "@dispatch/layout-contract";
import type { SetCwdRequest, WsServerMessage } from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WebSocketLike } from "../adapters/ws";
import { overlaySidePanels } from "../features/layout";
import App from "./App.svelte";
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

function fakeFetchImpl(): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/models(\?.*)?$/.test(url)) {
      return new Response(JSON.stringify({ models: ["opencode-1/deepseek-v4-flash"] }), {
        status: 200,
      });
    }
    if (url.endsWith("/layout")) {
      // No layout provider in these tests: the plan-02 no-provider signal.
      return new Response(JSON.stringify({ error: "No layout provider is active" }), {
        status: 404,
      });
    }
    if (url.includes("/conversations?status=")) {
      return new Response(JSON.stringify({ conversations: [] }), { status: 200 });
    }
    if (url.endsWith("/cwd")) {
      return new Response(JSON.stringify({ conversationId: "c", cwd: null }), { status: 200 });
    }
    if (url.endsWith("/lsp")) {
      return new Response(JSON.stringify({ conversationId: "c", cwd: null, servers: [] }), {
        status: 200,
      });
    }
    if (url.endsWith("/settings/vision")) {
      return new Response(JSON.stringify({ imageLimit: 10, compactionModel: null }), {
        status: 200,
      });
    }
    if (/\/plugins\/[^/]+\/frontend/.test(url)) {
      // plan 03 frontend module (no fixtures declare one) — the plain 404
      // the route returns for unknown/unloaded/frontend-less plugins.
      return new Response(JSON.stringify({ error: "No frontend module for this plugin" }), {
        status: 404,
      });
    }
    if (/\/plugins(\?.*)?$/.test(url)) {
      // Valid EMPTY list (plan 03): the plugin host's boot
      // `extensions-changed`/workspace syncs read this — a shapeless
      // fallback body would be cast to PluginListResponse and crash the
      // diff (`list.loaded` not iterable).
      return new Response(
        JSON.stringify({ loaded: [], disabledWithReason: [], discovered: [], missing: [] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ chunks: [], historyEpoch: 0, latestSeq: 0 }), {
      status: 200,
    });
  };
}

/**
 * A fetch whose layout provider is ACTIVE and serves the given sidebar
 * panels (plan 02): `GET /workspaces/:id/layout` returns DEFAULT_LAYOUT with
 * the views overlaid; `PUT` echoes the tree (200). Tests that need specific
 * sidebar views visible drive the layout through THIS edge — the pre-seeded
 * `dispatch.sidebar.views` localStorage is only read by the one-way §2.7
 * migration now.
 */
function fakeFetchWithLayout(views: readonly string[]): typeof fetch {
  const inner = fakeFetchImpl();
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/layout")) {
      const method = init?.method ?? "GET";
      if (method === "PUT" && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { tree: LayoutTree };
        return new Response(JSON.stringify({ tree: body.tree }), { status: 200 });
      }
      if (method === "GET") {
        const tree = overlaySidePanels(DEFAULT_LAYOUT, views);
        return new Response(JSON.stringify({ tree }), { status: 200 });
      }
      const tree = overlaySidePanels(DEFAULT_LAYOUT, views);
      return new Response(JSON.stringify({ tree }), { status: 200 });
    }
    return inner(input, init);
  };
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

function createFakeStorageWithViews(views: readonly string[] = ["extensions"]): Storage {
  const storage = createFakeStorage();
  storage.setItem("dispatch.sidebar.views", JSON.stringify(views));
  return storage;
}

function sentMessages(ws: FakeSocket) {
  return ws.sent.map((s) => JSON.parse(s));
}

function activeConversationId(store: ReturnType<typeof createAppStore>): string {
  const id = store.activeConversationId;
  expect(id).not.toBeNull();
  return id as string;
}

describe("App component interaction tests", () => {
  it.each([
    "all",
    "parent",
    "cancel",
  ] as const)("group close %s flows through the real store, persistence and HTTP close port", async (choice) => {
    const ws = fakeSocket();
    const storage = createFakeStorage();
    const closed: string[] = [];
    const base = fakeFetchWithLayout(["tabs"]);
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/conversations?status=")) {
          return new Response(
            JSON.stringify({
              conversations: [
                { id: "p", workspaceId: "default" },
                { id: "c1", workspaceId: "default", tabGroupParentId: "p" },
                { id: "c2", workspaceId: "default", tabGroupParentId: "p" },
                { id: "g", workspaceId: "default", tabGroupParentId: "c1" },
                { id: "solo", workspaceId: "default" },
                { id: "other-workspace", workspaceId: "other", tabGroupParentId: "p" },
              ].map((conversation) => ({
                ...conversation,
                title: conversation.id,
                status: "idle",
                lastActivityAt: 0,
              })),
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/close")) {
          expect(init?.method).toBe("POST");
          const id = url.split("/").at(-2) as string;
          closed.push(id);
          return new Response(JSON.stringify({ conversationId: id, abortedTurn: false }), {
            status: 200,
          });
        }
        return base(input, init);
      },
      localStorage: storage,
    });
    try {
      ws.resolveOpen();
      render(App, { props: { store, onNavigate: vi.fn() } });
      await screen.findByRole("tablist");
      for (const [id, parent] of [
        ["p", null],
        ["c1", "p"],
        ["c2", "p"],
        ["g", "c1"],
        ["solo", null],
      ] as const) {
        ws.feedServerMessage({
          type: "conversation.open",
          conversationId: id,
          workspaceId: "default",
          ...(parent === null ? {} : { tabGroupParentId: parent }),
        });
      }
      ws.feedServerMessage({
        type: "conversation.open",
        conversationId: "other-workspace",
        workspaceId: "other",
        tabGroupParentId: "p",
      });
      await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
      store.selectTab("p");
      const parent = await waitFor(() => {
        const tab = document.querySelector<HTMLElement>('[role="tab"][data-conversation-id="p"]');
        expect(tab).not.toBeNull();
        return tab;
      });
      if (parent === null) throw new Error("Parent tab missing");
      await fireEvent.click(within(parent).getByRole("button", { name: "Close tab" }));
      const dialog = screen.getByRole("dialog", { name: "Close subagents too?" });
      expect(dialog).toHaveTextContent("3 subagent tabs");
      expect(closed).toEqual([]);
      await fireEvent.click(
        within(dialog).getByRole("button", {
          name:
            choice === "all"
              ? /Yes, close all 4/
              : choice === "parent"
                ? /No, keep them open/
                : "Cancel",
        }),
      );
      const expected = choice === "all" ? ["p", "c1", "c2", "g"] : choice === "parent" ? ["p"] : [];
      expect(closed).toEqual(expected);
      expect(store.tabs.map((tab) => tab.conversationId)).toEqual(
        ["p", "c1", "c2", "g", "solo"].filter((id) => !expected.includes(id)),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      if (choice !== "cancel") {
        const persisted = JSON.parse(storage.getItem("dispatch.tabs") as string) as {
          tabs: { conversationId: string }[];
        };
        expect(persisted.tabs.map((tab) => tab.conversationId)).toEqual([
          ...["p", "c1", "c2", "g", "solo"].filter((id) => !expected.includes(id)),
          "other-workspace",
        ]);
        expect(store.activeConversationId).not.toBe("p");
      }
    } finally {
      store.dispose();
    }
  });

  it("renders the model selector and composer in draft mode", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    expect(screen.getByRole("textbox", { name: "Message input" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Model selector" })).toBeInTheDocument();

    store.dispose();
  });

  it("shows 'New Tab' in the top bar for an unstarted draft (no active tab)", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    expect(store.activeConversationId).toBeNull();
    expect(screen.getByTestId("top-bar-title")).toHaveTextContent("New Tab");

    store.dispose();
  });

  it("shows the active tab's title in the top bar once a tab is started", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    // Promote draft → tab: the tab's title is derived from the first message.
    store.send("Refactor the auth module");
    expect(store.activeConversationId).not.toBeNull();

    // The top-bar title updates reactively; findByTestId awaits the flush.
    expect(await screen.findByTestId("top-bar-title")).toHaveTextContent(
      "Refactor the auth module",
    );

    store.dispose();
  });

  it("the dashboard home button navigates to '/' (back to the workspaces home)", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    const onNavigate = vi.fn();
    render(App, { props: { store, onNavigate } });

    const homeBtn = screen.getByRole("link", { name: "Back to dashboard" });
    expect(homeBtn).toHaveAttribute("href", "/");
    await userEvent.setup().click(homeBtn);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("/");

    store.dispose();
  });

  it("auto-subscribes to every catalog entry on render (no buttons to click)", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
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

    render(App, { props: { store, onNavigate: vi.fn() } });

    const subscribed = sentMessages(ws)
      .filter((m: { type: string }) => m.type === "subscribe")
      .map((m: { surfaceId: string }) => m.surfaceId);
    expect(subscribed).toContain("s1");
    expect(subscribed).toContain("s2");

    store.dispose();
  });

  it("renders every surface expanded once their specs arrive", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchWithLayout(["extensions"]),
      localStorage: createFakeStorageWithViews(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "s1", region: "sidebar", title: "Surface One" },
        { id: "s2", region: "panel", title: "Surface Two" },
      ],
    });

    render(App, { props: { store, onNavigate: vi.fn() } });

    // No interaction: specs arrive and both surfaces render expanded.
    ws.feedSurfaceMessage({
      type: "surface",
      spec: {
        id: "s1",
        region: "sidebar",
        title: "Surface One",
        fields: [{ kind: "stat", label: "Tokens", value: "1,234" }],
      },
    });
    ws.feedSurfaceMessage({
      type: "surface",
      spec: { id: "s2", region: "panel", title: "Surface Two", fields: [] },
    });

    expect(await screen.findByRole("heading", { name: "Surface One" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Surface Two" })).toBeInTheDocument();
    expect(await screen.findByText("Tokens")).toBeInTheDocument();
    expect(await screen.findByText("1,234")).toBeInTheDocument();

    store.dispose();
  });

  it("an error message renders the alert banner", () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "error",
      message: "Something went wrong",
    });

    render(App, { props: { store, onNavigate: vi.fn() } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");

    store.dispose();
  });

  it("invoking a field action sends an invoke", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchWithLayout(["extensions"]),
      localStorage: createFakeStorageWithViews(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
    });

    render(App, { props: { store, onNavigate: vi.fn() } });

    const user = userEvent.setup();
    // Surface is auto-subscribed; its spec arrives and renders expanded.
    ws.feedSurfaceMessage({
      type: "surface",
      spec: {
        id: "s1",
        region: "sidebar",
        title: "Surface One",
        fields: [
          {
            kind: "toggle",
            label: "Dark Mode",
            value: false,
            action: { actionId: "toggle-dark" },
          },
        ],
      },
    });

    ws.sent.length = 0;
    const checkbox = await screen.findByRole("checkbox", { name: "Dark Mode" });
    await user.click(checkbox);

    const msgs = sentMessages(ws);
    const invoke = msgs.find(
      (m: { type: string; surfaceId: string; actionId: string; payload: unknown }) =>
        m.type === "invoke" &&
        m.surfaceId === "s1" &&
        m.actionId === "toggle-dark" &&
        m.payload === true,
    );
    expect(invoke).toBeTruthy();

    store.dispose();
  });

  it("typing and sending a message posts chat.send on the socket", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    const user = userEvent.setup();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "hello from UI");

    ws.sent.length = 0;
    const sendBtn = screen.getByRole("button", { name: "Send" });
    await user.click(sendBtn);

    const msgs = sentMessages(ws);
    const chatSend = msgs.find((m: { type: string }) => m.type === "chat.send") as
      | { type: string; conversationId: string; message: string }
      | undefined;
    expect(chatSend).toBeTruthy();
    expect(chatSend?.message).toBe("hello from UI");

    store.dispose();
  });

  it.each([
    "look at this",
    "",
  ])("queues staged images through the full UI with text %j", async (text) => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
      chatFlushScheduler: null,
    });
    ws.resolveOpen();
    const { container } = render(App, { props: { store, onNavigate: vi.fn() } });
    const user = userEvent.setup();
    const textarea = screen.getByRole("textbox", { name: "Message input" });
    await user.type(textarea, "start");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const conversationId = activeConversationId(store);
    ws.feedServerMessage({
      type: "chat.delta",
      event: { type: "turn-start", conversationId, turnId: "t1" },
    });
    if (text) await user.type(textarea, text);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["GIF"], "shot.gif", { type: "image/gif" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await screen.findByRole("button", { name: "Remove image" });
    ws.sent.length = 0;

    await user.click(screen.getByRole("button", { name: "Queue" }));

    expect(sentMessages(ws).filter((m: { type: string }) => m.type.startsWith("chat."))).toEqual([
      {
        type: "chat.queue",
        requestId: expect.any(String),
        conversationId,
        workspaceId: "default",
        text,
        images: [{ url: "data:image/gif;base64,R0lG", mimeType: "image/gif" }],
      },
    ]);
    expect(textarea).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();
    store.dispose();
  });

  it("uses only the focused conversation's queue snapshot for the Flush label and POSTs stop", async () => {
    const ws = fakeSocket();
    const fetchImpl = vi.fn(fakeFetchImpl());
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl,
      localStorage: createFakeStorage(),
      chatFlushScheduler: null,
    });
    ws.resolveOpen();
    render(App, { props: { store, onNavigate: vi.fn() } });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message input" }), "start");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const firstId = activeConversationId(store);
    const startTurn = (conversationId: string) =>
      ws.feedServerMessage({
        type: "chat.delta",
        event: { type: "turn-start", conversationId, turnId: `turn-${conversationId}` },
      });
    const pushQueue = (conversationId: string, payload: unknown) =>
      ws.feedSurfaceMessage({
        type: "surface",
        conversationId,
        spec: {
          id: "message-queue",
          region: "inline",
          title: "Message queue",
          fields: [{ kind: "custom", rendererId: "message-queue", payload }],
        },
      });
    startTurn(firstId);
    await screen.findByRole("button", { name: "Stop generation" });
    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [
        { id: "message-queue", region: "inline", title: "Message queue", scope: "conversation" },
      ],
    });
    const pending = { messages: [{ id: "m1", text: "next", queuedAt: 1 }] };
    pushQueue(firstId, pending);
    const flush = await screen.findByRole("button", { name: "Flush" });
    ws.sent.length = 0;
    fetchImpl.mockClear();
    await user.click(flush);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([
      [expect.stringContaining(`/conversations/${firstId}/stop`), { method: "POST" }],
    ]);
    expect(sentMessages(ws)).toEqual([]); // No new send, queue, or cancel operation.

    store.newDraft();
    await user.type(screen.getByRole("textbox", { name: "Message input" }), "second");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const secondId = activeConversationId(store);
    expect(secondId).not.toBe(firstId);
    startTurn(secondId);
    await screen.findByRole("button", { name: "Stop generation" });
    pushQueue(firstId, pending); // Late old-scope update must not relabel the new conversation.
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop generation" })).toBeInTheDocument(),
    );
    pushQueue(secondId, pending);
    await screen.findByRole("button", { name: "Flush" });
    pushQueue(secondId, { messages: [] });
    await screen.findByRole("button", { name: "Stop generation" });
    pushQueue(secondId, { messages: "malformed" });
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop generation" })).toBeInTheDocument(),
    );
    store.dispose();
  });

  it("incoming chat.delta renders text in the chat transcript", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(),
      localStorage: createFakeStorage(),
      chatFlushScheduler: null,
    });
    ws.resolveOpen();

    // Promote draft to tab
    store.send("test");
    const convId = activeConversationId(store);

    render(App, { props: { store, onNavigate: vi.fn() } });

    ws.feedServerMessage({
      type: "chat.delta",
      event: {
        type: "turn-start",
        conversationId: convId,
        turnId: "turn-1",
      },
    });

    ws.feedServerMessage({
      type: "chat.delta",
      event: {
        type: "text-delta",
        conversationId: convId,
        turnId: "turn-1",
        delta: "Hi there!",
      },
    });

    expect(await screen.findByText("Hi there!")).toBeInTheDocument();

    store.dispose();
  });

  it("renders a custom 'table' field of a surface as a table", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchWithLayout(["extensions"]),
      localStorage: createFakeStorageWithViews(),
    });
    ws.resolveOpen();

    ws.feedSurfaceMessage({
      type: "catalog",
      catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
    });

    render(App, { props: { store, onNavigate: vi.fn() } });

    // Auto-subscribed; the custom-table spec arrives and renders expanded.
    ws.feedSurfaceMessage({
      type: "surface",
      spec: {
        id: "s1",
        region: "sidebar",
        title: "Surface One",
        fields: [
          {
            kind: "custom",
            rendererId: "table",
            payload: {
              columns: ["Name", "Scope"],
              rows: [["cache-warm", "backend"]],
            },
          },
        ],
      },
    });

    expect(await screen.findByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(await screen.findByText("cache-warm")).toBeInTheDocument();
    expect(await screen.findByText("backend")).toBeInTheDocument();

    store.dispose();
  });

  it("the Extensions view lists frontend modules aggregated from feature manifests", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchWithLayout(["extensions"]),
      localStorage: createFakeStorageWithViews(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    // The Extensions view arrives with the provider's tree (an async GET —
    // plan 02), so await the modules table rendering.
    expect(await screen.findByRole("columnheader", { name: "Module" })).toBeInTheDocument();
    for (const name of [
      "chat",
      "tabs",
      "surface-host",
      "views",
      "conversation-cache",
      "markdown",
    ]) {
      expect(screen.getByRole("cell", { name })).toBeInTheDocument();
    }

    store.dispose();
  });

  it("shows a full-screen error modal when fetchOpenConversations fails", async () => {
    // A fetch that throws for the conversations list endpoint (simulating a
    // network failure / unreachable backend on a new device).
    const failingFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/models(\?.*)?$/.test(url)) {
        return new Response(JSON.stringify({ models: ["opencode-1/deepseek-v4-flash"] }), {
          status: 200,
        });
      }
      if (url.includes("/conversations?status=")) {
        throw new TypeError("Failed to fetch: network error");
      }
      if (url.endsWith("/cwd")) {
        return new Response(JSON.stringify({ conversationId: "c", cwd: null }), { status: 200 });
      }
      if (url.endsWith("/lsp")) {
        return new Response(JSON.stringify({ conversationId: "c", cwd: null, servers: [] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ chunks: [], historyEpoch: 0, latestSeq: 0 }), {
        status: 200,
      });
    };

    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: failingFetch,
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    // The modal should appear with the error text
    const dialog = await screen.findByRole("dialog", { name: "Error" }, { timeout: 3000 });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Failed to load conversations");
    expect(dialog).toHaveTextContent("TypeError");
    expect(dialog).toHaveTextContent("network error");

    // Dismiss button clears the modal
    const dismissBtn = screen.getByRole("button", { name: "Dismiss error" });
    await userEvent.setup().click(dismissBtn);
    expect(store.fatalError).toBeNull();

    store.dispose();
  });

  it("does not show the error modal when fetchOpenConversations succeeds", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchImpl(), // returns valid empty conversations list
      localStorage: createFakeStorage(),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    // Wait a tick for boot async to settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(store.fatalError).toBeNull();

    store.dispose();
  });

  it("sends workspaceId when setting cwd", async () => {
    let capturedBody: SetCwdRequest | undefined;
    const fetchWithCapture = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/cwd") && init?.method === "PUT") {
        capturedBody = JSON.parse(init.body as string) as SetCwdRequest;
        return new Response(JSON.stringify({ conversationId: "c", cwd: capturedBody.cwd }), {
          status: 200,
        });
      }
      return fakeFetchImpl()(input);
    };

    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fetchWithCapture,
      localStorage: createFakeStorage(),
      workspaceId: "my-team",
    });
    ws.resolveOpen();

    // Let async boot settle before mutating cwd.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = await store.setCwd("arch-rewrite");
    expect(result).toMatchObject({ ok: true, cwd: "arch-rewrite" });
    expect(capturedBody).toEqual({ cwd: "arch-rewrite", workspaceId: "my-team" });

    store.dispose();
  });

  it("the Vision view renders the vision settings UI (image limit + compaction model)", async () => {
    const ws = fakeSocket();
    const store = createAppStore({
      socketFactory: () => ws,
      fetchImpl: fakeFetchWithLayout(["vision"]),
      localStorage: createFakeStorageWithViews(["vision"]),
    });
    ws.resolveOpen();

    render(App, { props: { store, onNavigate: vi.fn() } });

    // The vision settings load (`GET /settings/vision`) seeds the inputs.
    expect(await screen.findByLabelText(/Image limit/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Compaction model/)).toBeInTheDocument();

    store.dispose();
  });
});
