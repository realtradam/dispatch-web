import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	WsClientMessage,
} from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
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
	onChat?: (msg: ChatDeltaMessage | ChatErrorMessage) => void;
	onReopen?: () => void;
	socketFactory?: (url: string) => WebSocketLike;
}

export interface SurfaceSocketHandle {
	send(msg: WsClientMessage): void;
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
				if (msg.type === "chat.delta" || msg.type === "chat.error") {
					opts.onChat?.(msg as ChatDeltaMessage | ChatErrorMessage);
				} else {
					opts.onMessage(msg as SurfaceServerMessage);
				}
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
		send(msg: WsClientMessage): void {
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
