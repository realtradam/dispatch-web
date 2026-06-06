import type { SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import type { WebSocketLike } from "../adapters/ws";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../adapters/ws";
import {
	applyServerMessage,
	initialState,
	type ProtocolState,
	invoke as protocolInvoke,
	subscribe as protocolSubscribe,
	unsubscribe as protocolUnsubscribe,
} from "../core/protocol";
import { resolveWsUrl } from "./resolve-ws-url";

export interface AppStore {
	readonly catalog: ProtocolState["catalog"];
	readonly selectedId: string | null;
	readonly selectedSpec: SurfaceSpec | null;
	readonly lastError: ProtocolState["lastError"];
	select(surfaceId: string): void;
	invoke(surfaceId: string, actionId: string, payload?: unknown): void;
	dispose(): void;
}

export function createAppStore(opts?: {
	url?: string;
	socketFactory?: (url: string) => WebSocketLike;
}): AppStore {
	let protocol = $state<ProtocolState>(initialState());
	let selectedId = $state<string | null>(null);

	let socket: ReturnType<typeof createSurfaceSocket> | null = null;

	function handleServerMessage(msg: SurfaceServerMessage): void {
		protocol = applyServerMessage(protocol, msg);
	}

	const wsLocation = typeof location !== "undefined" ? location : undefined;
	const url =
		opts?.url ??
		resolveWsUrl(
			{ VITE_WS_URL: import.meta.env.VITE_WS_URL, VITE_WS_PORT: import.meta.env.VITE_WS_PORT },
			wsLocation,
		);
	const socketOpts: SurfaceSocketOptions = {
		url,
		onMessage: handleServerMessage,
		onReopen() {
			if (selectedId !== null) {
				const result = protocolSubscribe(protocol, selectedId);
				protocol = result.state;
				for (const msg of result.outgoing) {
					socket?.send(msg);
				}
			}
		},
	};
	if (opts?.socketFactory !== undefined) {
		socketOpts.socketFactory = opts.socketFactory;
	}
	socket = createSurfaceSocket(socketOpts);

	return {
		get catalog() {
			return protocol.catalog;
		},
		get selectedId() {
			return selectedId;
		},
		get selectedSpec() {
			if (selectedId === null) return null;
			return protocol.subscriptions.get(selectedId) ?? null;
		},
		get lastError() {
			return protocol.lastError;
		},
		select(surfaceId: string): void {
			if (selectedId !== null && selectedId !== surfaceId) {
				const unsub = protocolUnsubscribe(protocol, selectedId);
				protocol = unsub.state;
				for (const msg of unsub.outgoing) {
					socket?.send(msg);
				}
			}
			selectedId = surfaceId;
			const sub = protocolSubscribe(protocol, surfaceId);
			protocol = sub.state;
			for (const msg of sub.outgoing) {
				socket?.send(msg);
			}
		},
		invoke(surfaceId: string, actionId: string, payload?: unknown): void {
			const result = protocolInvoke(protocol, surfaceId, actionId, payload);
			protocol = result.state;
			for (const msg of result.outgoing) {
				socket?.send(msg);
			}
		},
		dispose(): void {
			socket?.close();
			socket = null;
		},
	};
}
