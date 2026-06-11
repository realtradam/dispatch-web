import type { WsServerMessage } from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WebSocketLike } from "../adapters/ws";
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
		if (url.endsWith("/models")) {
			return new Response(JSON.stringify({ models: ["opencode/deepseek-v4-flash"] }), {
				status: 200,
			});
		}
		return new Response(JSON.stringify({ chunks: [], latestSeq: 0 }), { status: 200 });
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

function sentMessages(ws: FakeSocket) {
	return ws.sent.map((s) => JSON.parse(s));
}

function activeConversationId(store: ReturnType<typeof createAppStore>): string {
	const id = store.activeConversationId;
	expect(id).not.toBeNull();
	return id as string;
}

describe("App component interaction tests", () => {
	it("renders the model selector and composer in draft mode", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		render(App, { props: { store } });

		expect(screen.getByRole("textbox", { name: "Message input" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "Model selector" })).toBeInTheDocument();

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

		render(App, { props: { store } });

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
			fetchImpl: fakeFetchImpl(),
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

		render(App, { props: { store } });

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

		render(App, { props: { store } });

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Something went wrong");

		store.dispose();
	});

	it("invoking a field action sends an invoke", async () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		ws.feedSurfaceMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		render(App, { props: { store } });

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

		render(App, { props: { store } });

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

	it("incoming chat.delta renders text in the chat transcript", async () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		// Promote draft to tab
		store.send("test");
		const convId = activeConversationId(store);

		render(App, { props: { store } });

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
			fetchImpl: fakeFetchImpl(),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		ws.feedSurfaceMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		render(App, { props: { store } });

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

	it("the Extensions view lists frontend modules aggregated from feature manifests", () => {
		const ws = fakeSocket();
		const store = createAppStore({
			socketFactory: () => ws,
			fetchImpl: fakeFetchImpl(),
			localStorage: createFakeStorage(),
		});
		ws.resolveOpen();

		render(App, { props: { store } });

		// Extensions is the default view, so the modules table renders immediately.
		expect(screen.getByRole("columnheader", { name: "Module" })).toBeInTheDocument();
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
});
