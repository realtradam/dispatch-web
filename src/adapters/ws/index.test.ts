import { describe, expect, it, vi } from "vitest";
import type { WebSocketLike } from "./index";
import { createSurfaceSocket } from "./index";

interface FakeSocket extends WebSocketLike {
	sent: string[];
	resolveOpen(): void;
	invokeMessage(data: string): void;
	invokeClose(): void;
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
		invokeClose() {
			onclose?.({ code: 1000, reason: "" });
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
});
