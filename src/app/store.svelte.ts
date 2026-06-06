import type { ConversationHistoryResponse } from "@dispatch/transport-contract";
import type { SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import { createIdbChunkStore } from "../adapters/idb";
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
import type { ChatStore } from "../features/chat";
import { createChatStore } from "../features/chat";
import type { ConversationCache } from "../features/conversation-cache";
import { createConversationCache } from "../features/conversation-cache";
import { resolveHttpUrl } from "./resolve-http-url";
import { resolveWsUrl } from "./resolve-ws-url";
import { randomId } from "./uuid";

export interface AppStore {
	readonly catalog: ProtocolState["catalog"];
	readonly selectedId: string | null;
	readonly selectedSpec: SurfaceSpec | null;
	readonly lastError: ProtocolState["lastError"];
	readonly chat: ChatStore;
	select(surfaceId: string): void;
	invoke(surfaceId: string, actionId: string, payload?: unknown): void;
	dispose(): void;
}

export interface CreateAppStoreOptions {
	url?: string;
	httpUrl?: string;
	socketFactory?: (url: string) => WebSocketLike;
	fetchImpl?: typeof fetch;
	indexedDB?: IDBFactory;
	conversationId?: string;
}

function createHistorySync(
	httpBase: string,
	fetchImpl: typeof fetch,
): (conversationId: string, sinceSeq: number) => Promise<ConversationHistoryResponse> {
	return async (conversationId: string, sinceSeq: number) => {
		const url = `${httpBase}/conversations/${encodeURIComponent(conversationId)}?sinceSeq=${sinceSeq}`;
		const res = await fetchImpl(url);
		if (!res.ok) {
			throw new Error(`History sync failed: ${res.status}`);
		}
		return (await res.json()) as ConversationHistoryResponse;
	};
}

export function createAppStore(opts?: CreateAppStoreOptions): AppStore {
	let protocol = $state<ProtocolState>(initialState());
	let selectedId = $state<string | null>(null);

	let socket: ReturnType<typeof createSurfaceSocket> | null = null;

	function handleServerMessage(msg: SurfaceServerMessage): void {
		protocol = applyServerMessage(protocol, msg);
	}

	const wsLocation = typeof location !== "undefined" ? location : undefined;
	const wsUrl =
		opts?.url ??
		resolveWsUrl(
			{ VITE_WS_URL: import.meta.env.VITE_WS_URL, VITE_WS_PORT: import.meta.env.VITE_WS_PORT },
			wsLocation,
		);

	const httpLocation = typeof location !== "undefined" ? location : undefined;
	const httpBase =
		opts?.httpUrl ??
		resolveHttpUrl(
			{
				VITE_HTTP_URL: import.meta.env.VITE_HTTP_URL,
				VITE_HTTP_PORT: import.meta.env.VITE_HTTP_PORT,
			},
			httpLocation,
		);

	const fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
	const indexedDBFactory = opts?.indexedDB ?? globalThis.indexedDB;
	const conversationId = opts?.conversationId ?? randomId();

	const cache: ConversationCache = createConversationCache(
		createIdbChunkStore({ indexedDB: indexedDBFactory }),
	);

	const historySync = createHistorySync(httpBase, fetchImpl);

	const chatStore = createChatStore({
		conversationId,
		transport: {
			send(msg) {
				socket?.send(msg);
			},
		},
		historySync,
		cache,
	});

	let chat = $state<ChatStore>(chatStore as ChatStore);

	const socketOpts: SurfaceSocketOptions = {
		url: wsUrl,
		onMessage: handleServerMessage,
		onChat(msg) {
			chatStore.handleDelta(msg);
		},
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

	void chatStore.load();

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
		get chat() {
			return chat;
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
			chatStore.dispose();
			socket?.close();
			socket = null;
		},
	};
}
