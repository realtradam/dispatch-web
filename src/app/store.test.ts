import type { ConversationHistoryResponse, WsServerMessage } from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
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
}

function fakeFetchImpl(opts?: FakeFetchOptions): typeof fetch {
	const models = opts?.models ?? ["opencode/deepseek-v4-flash", "openai/gpt-4o"];
	const history = opts?.history ?? {};
	return async (input: string | URL | Request): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url.endsWith("/models")) {
			return new Response(JSON.stringify({ models }), { status: 200 });
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
			if (url.endsWith("/models")) {
				return new Response(JSON.stringify({ models: ["opencode/deepseek-v4-flash"] }), {
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

		await new Promise((r) => setTimeout(r, 50));

		expect(fetchedUrls.some((u) => u.includes(`/conversations/${convId}?sinceSeq=`))).toBe(true);

		await new Promise((r) => setTimeout(r, 50));

		expect(store.activeChat.chunks.length).toBeGreaterThan(0);

		store.dispose();
	});

	it("fetches and exposes the model catalog", async () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl({
				models: ["opencode/deepseek-v4-flash", "openai/gpt-4o", "anthropic/claude-3"],
			}),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		await new Promise((r) => setTimeout(r, 50));

		expect(store.models).toEqual([
			"opencode/deepseek-v4-flash",
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

		expect(store.activeModel).toBe("opencode/deepseek-v4-flash");

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

	it("selecting a model updates the active tab", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		store.send("hello");

		store.selectModel("openai/gpt-4o");

		expect(store.activeModel).toBe("openai/gpt-4o");
		expect(store.tabs[0]?.model).toBe("openai/gpt-4o");

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
			if (url.endsWith("/models")) {
				return new Response(JSON.stringify({ models: ["opencode/deepseek-v4-flash"] }), {
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
});
