import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { describe, expect, it } from "vitest";
import type { WebSocketLike } from "../adapters/ws";
import { createAppStore } from "./store.svelte";

interface FakeSocket extends WebSocketLike {
	sent: string[];
	resolveOpen(): void;
	feedMessage(data: SurfaceServerMessage): void;
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
		feedMessage(msg: SurfaceServerMessage) {
			onmessage?.({ data: JSON.stringify(msg) });
		},
		sent,
	};
	return ws;
}

describe("createAppStore", () => {
	it("starts with empty catalog and no selection", () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		expect(store.catalog).toEqual([]);
		expect(store.selectedId).toBeNull();
		expect(store.selectedSpec).toBeNull();
		expect(store.lastError).toBeNull();

		store.dispose();
	});

	it("updates catalog when catalog message arrives", () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
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
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
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
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
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
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		store.select("s1");

		ws.feedMessage({
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
		const store = createAppStore({ socketFactory: () => ws });
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
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
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

		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		store.dispose();
		expect(closeSpy.called).toBe(true);
	});
});
