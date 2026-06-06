import type { SurfaceClientMessage, SurfaceServerMessage } from "@dispatch/ui-contract";
import { nextBackoffMs, parseServerMessage, serialize } from "./logic";

export interface WebSocketLike {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((ev: { data: string }) => void) | null;
	onclose: ((ev: { code: number; reason: string }) => void) | null;
}

export interface SurfaceSocketOptions {
	url: string;
	onMessage: (msg: SurfaceServerMessage) => void;
	onReopen?: () => void;
	socketFactory?: (url: string) => WebSocketLike;
}

export interface SurfaceSocketHandle {
	send(msg: SurfaceClientMessage): void;
	close(): void;
}

export function createSurfaceSocket(opts: SurfaceSocketOptions): SurfaceSocketHandle {
	const factory =
		opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);

	let socket: WebSocketLike | null = null;
	let disposed = false;
	let reconnectAttempt = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let isOpen = false;
	const queue: string[] = [];

	function connect(isReconnect: boolean): void {
		socket = factory(opts.url);
		isOpen = false;

		socket.onopen = () => {
			if (disposed) return;
			isOpen = true;
			reconnectAttempt = 0;
			for (const raw of queue.splice(0)) {
				socket?.send(raw);
			}
			if (isReconnect) {
				opts.onReopen?.();
			}
		};

		socket.onmessage = (ev) => {
			if (disposed) return;
			const msg = parseServerMessage(ev.data);
			if (msg !== null) {
				opts.onMessage(msg);
			}
		};

		socket.onclose = () => {
			if (disposed) return;
			isOpen = false;
			scheduleReconnect();
		};
	}

	function scheduleReconnect(): void {
		const delay = nextBackoffMs(reconnectAttempt);
		reconnectAttempt++;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			if (disposed) return;
			connect(true);
		}, delay);
	}

	connect(false);

	return {
		send(msg: SurfaceClientMessage): void {
			if (disposed) return;
			const raw = serialize(msg);
			if (isOpen) {
				socket?.send(raw);
			} else {
				queue.push(raw);
			}
		},
		close(): void {
			disposed = true;
			if (reconnectTimer !== null) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			socket?.close();
			socket = null;
		},
	};
}
