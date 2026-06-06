import type { ConversationHistoryResponse, WsServerMessage } from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { describe, expect, it } from "vitest";
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

function fakeFetchImpl(responses: Record<string, unknown> = {}): typeof fetch {
	return async (input: string | URL | Request): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const body =
			responses[url] ?? ({ chunks: [], latestSeq: 0 } satisfies ConversationHistoryResponse);
		return new Response(JSON.stringify(body), { status: 200 });
	};
}

function parseSent(ws: FakeSocket): unknown[] {
	return ws.sent.map((s) => JSON.parse(s));
}

describe("createAppStore", () => {
	it("starts with empty catalog and no selection", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		expect(store.catalog).toEqual([]);
		expect(store.selectedId).toBeNull();
		expect(store.selectedSpec).toBeNull();
		expect(store.lastError).toBeNull();

		store.dispose();
	});

	it("updates catalog when catalog message arrives", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
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

	it("select sends subscribe and sets selectedId", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		ws.feedSurfaceMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		ws.sent.length = 0;
		store.select("s1");

		expect(store.selectedId).toBe("s1");
		const subscribeMsg = ws.sent.find((s) => {
			const parsed = JSON.parse(s);
			return parsed.type === "subscribe" && parsed.surfaceId === "s1";
		});
		expect(subscribeMsg).toBeTruthy();

		store.dispose();
	});

	it("selecting a different surface unsubscribes from previous", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
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
		store.select("s1");
		store.select("s2");

		const unsubscribeMsg = ws.sent.find((s) => {
			const parsed = JSON.parse(s);
			return parsed.type === "unsubscribe" && parsed.surfaceId === "s1";
		});
		expect(unsubscribeMsg).toBeTruthy();

		const subscribeMsg = ws.sent.find((s) => {
			const parsed = JSON.parse(s);
			return parsed.type === "subscribe" && parsed.surfaceId === "s2";
		});
		expect(subscribeMsg).toBeTruthy();

		store.dispose();
	});

	it("surface message updates selectedSpec", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		ws.feedSurfaceMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		store.select("s1");

		ws.feedSurfaceMessage({
			type: "surface",
			spec: {
				id: "s1",
				region: "sidebar",
				title: "Surface One",
				fields: [{ kind: "stat", label: "Tokens", value: "1,234" }],
			},
		});

		expect(store.selectedSpec).not.toBeNull();
		expect(store.selectedSpec?.id).toBe("s1");
		expect(store.selectedSpec?.fields).toHaveLength(1);

		store.dispose();
	});

	it("invoke sends an invoke message", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
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
		});
		ws.resolveOpen();

		store.dispose();
		expect(closeSpy.called).toBe(true);
	});

	it("exposes chat store with empty initial messages", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		expect(store.chat).toBeDefined();
		expect(store.chat.messages).toEqual([]);
		expect(store.chat.chunks).toEqual([]);
		expect(store.chat.error).toBeNull();

		store.dispose();
	});

	it("sending a message posts a chat.send on the socket", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		ws.sent.length = 0;
		store.chat.send("hello world");

		const msgs = parseSent(ws);
		const chatSend = msgs.find((m) => (m as { type: string }).type === "chat.send") as
			| { type: string; conversationId: string; message: string }
			| undefined;
		expect(chatSend).toBeTruthy();
		expect(chatSend?.conversationId).toBe("test-conv");
		expect(chatSend?.message).toBe("hello world");

		store.dispose();
	});

	it("an incoming chat.delta renders in the transcript", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		ws.feedServerMessage({
			type: "chat.delta",
			event: {
				type: "turn-start",
				conversationId: "test-conv",
				turnId: "turn-1",
			},
		});

		ws.feedServerMessage({
			type: "chat.delta",
			event: {
				type: "text-delta",
				conversationId: "test-conv",
				turnId: "turn-1",
				delta: "Hello ",
			},
		});

		ws.feedServerMessage({
			type: "chat.delta",
			event: {
				type: "text-delta",
				conversationId: "test-conv",
				turnId: "turn-1",
				delta: "world",
			},
		});

		expect(store.chat.chunks.length).toBeGreaterThan(0);
		const textChunks = store.chat.chunks.filter((c) => c.chunk.type === "text");
		expect(textChunks).toHaveLength(1);
		expect((textChunks[0]?.chunk as { type: "text"; text: string }).text).toBe("Hello world");

		store.dispose();
	});

	it("chat.error sets the chat error", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			conversationId: "test-conv",
		});
		ws.resolveOpen();

		ws.feedServerMessage({
			type: "chat.error",
			message: "bad request",
		});

		expect(store.chat.error).toBe("bad request");

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
			return new Response(JSON.stringify(historyResponse), { status: 200 });
		};

		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl,
			conversationId: "test-conv",
			httpUrl: "http://localhost:24203",
		});
		ws.resolveOpen();

		ws.feedServerMessage({
			type: "chat.delta",
			event: {
				type: "turn-start",
				conversationId: "test-conv",
				turnId: "turn-1",
			},
		});

		ws.feedServerMessage({
			type: "chat.delta",
			event: {
				type: "turn-sealed",
				conversationId: "test-conv",
				turnId: "turn-1",
			},
		});

		await new Promise((r) => setTimeout(r, 50));

		expect(fetchedUrls.some((u) => u.includes("/conversations/test-conv?sinceSeq="))).toBe(true);

		await new Promise((r) => setTimeout(r, 50));

		expect(store.chat.chunks.length).toBeGreaterThan(0);

		store.dispose();
	});
});
