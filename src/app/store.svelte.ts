import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	ConversationHistoryResponse,
	ConversationMetricsResponse,
	ModelsResponse,
	WarmRequest,
	WarmResponse,
} from "@dispatch/transport-contract";
import type { SubscribeMessage, SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import { createIdbChunkStore } from "../adapters/idb";
import { createLocalStore } from "../adapters/local-storage";
import type { WebSocketLike } from "../adapters/ws";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../adapters/ws";
import {
	applyServerMessage,
	getSurfaceSpec,
	type ProtocolState,
	initialState as protocolInitialState,
	invoke as protocolInvoke,
	subscribe as protocolSubscribe,
	unsubscribe as protocolUnsubscribe,
} from "../core/protocol";
import type { ChatStore, MetricsSync } from "../features/chat";
import { createChatStore } from "../features/chat";
import type { ConversationCache } from "../features/conversation-cache";
import { createConversationCache } from "../features/conversation-cache";
import type { Tab, TabsState } from "../features/tabs";
import { createTabsStore, deriveTitle, type TabsStore } from "../features/tabs";
import { resolveHttpUrl } from "./resolve-http-url";
import { resolveWsUrl } from "./resolve-ws-url";
import { randomId } from "./uuid";

const DEFAULT_MODEL = "opencode/deepseek-v4-flash";

/** Outcome of a manual `POST /chat/warm` (the "warm now" affordance). */
export type WarmResult =
	| { readonly ok: true; readonly response: WarmResponse }
	| { readonly ok: false; readonly error: string };

export interface AppStore {
	readonly tabs: readonly Tab[];
	readonly activeConversationId: string | null;
	readonly activeChat: ChatStore;
	readonly models: readonly string[];
	readonly activeModel: string;
	readonly catalog: ProtocolState["catalog"];
	/** Every received surface spec, in catalog order — all auto-subscribed + expanded. */
	readonly surfaces: readonly SurfaceSpec[];
	readonly lastError: ProtocolState["lastError"];
	/** The current spec for one surface by id (discovery-by-id), or null if absent. */
	surface(surfaceId: string): SurfaceSpec | null;
	send(text: string): void;
	selectModel(model: string): void;
	newDraft(): void;
	selectTab(conversationId: string): void;
	closeTab(conversationId: string): void;
	invoke(surfaceId: string, actionId: string, payload?: unknown): void;
	/**
	 * Manually warm the focused conversation's prompt cache (`POST /chat/warm`).
	 * Returns null when no conversation is focused (a draft has nothing to warm).
	 */
	warmNow(): Promise<WarmResult | null>;
	dispose(): void;
}

export interface CreateAppStoreOptions {
	url?: string;
	httpUrl?: string;
	socketFactory?: (url: string) => WebSocketLike;
	fetchImpl?: typeof fetch;
	indexedDB?: IDBFactory;
	conversationId?: string;
	localStorage?: Storage;
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

function createMetricsSync(httpBase: string, fetchImpl: typeof fetch): MetricsSync {
	return async (conversationId: string) => {
		const url = `${httpBase}/conversations/${encodeURIComponent(conversationId)}/metrics`;
		const res = await fetchImpl(url);
		if (!res.ok) return { turns: [] };
		return (await res.json()) as ConversationMetricsResponse;
	};
}

export function createAppStore(opts?: CreateAppStoreOptions): AppStore {
	let protocol = $state<ProtocolState>(protocolInitialState());
	let models = $state<readonly string[]>([]);
	let activeModel = $state(DEFAULT_MODEL);

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
	const localStorageOpt = opts?.localStorage ?? globalThis.localStorage;

	const storageAdapter = createLocalStore<TabsState>("dispatch.tabs", {
		storage: localStorageOpt,
	});
	const tabsStore: TabsStore = createTabsStore(storageAdapter);

	const cache: ConversationCache = createConversationCache(
		createIdbChunkStore({ indexedDB: indexedDBFactory }),
	);

	const historySync = createHistorySync(httpBase, fetchImpl);
	const metricsSync = createMetricsSync(httpBase, fetchImpl);

	const chatStores = new Map<string, ChatStore>();

	function createChatFor(conversationId: string, model: string): ChatStore {
		return createChatStore({
			conversationId,
			model,
			transport: {
				send(msg) {
					socket?.send(msg);
				},
			},
			historySync,
			metricsSync,
			cache,
		});
	}

	const initialDraftId = randomId();
	let draftStore: ChatStore = createChatFor(initialDraftId, activeModel);
	let draftConversationId: string = initialDraftId;

	let activeChat = $state<ChatStore>(draftStore as ChatStore);

	function getActiveChat(): ChatStore {
		const activeId = tabsStore.activeConversationId;
		if (activeId === null) {
			return draftStore;
		}
		return chatStores.get(activeId) ?? draftStore;
	}

	function refreshActiveChat(): void {
		activeChat = getActiveChat();
	}

	function handleChatMessage(msg: ChatDeltaMessage | ChatErrorMessage): void {
		let targetId: string | undefined;
		if (msg.type === "chat.delta") {
			targetId = msg.event.conversationId;
		} else {
			targetId = msg.conversationId;
		}

		if (targetId !== undefined) {
			const store = chatStores.get(targetId);
			if (store !== undefined) {
				store.handleDelta(msg);
				return;
			}
		}

		// fallback: try all stores (chat.error without conversationId)
		for (const store of chatStores.values()) {
			store.handleDelta(msg);
		}
	}

	/** The conversation the surfaces should scope to (undefined for a draft). */
	function focusedConversationId(): string | undefined {
		return tabsStore.activeConversationId ?? undefined;
	}

	function handleServerMessage(msg: SurfaceServerMessage): void {
		protocol = applyServerMessage(protocol, msg);
		// Surfaces are auto-expanded: whenever the catalog changes, subscribe to
		// every entry (and drop subscriptions for entries that vanished).
		if (msg.type === "catalog") {
			syncSubscriptions();
		}
	}

	/**
	 * Subscribe to every catalog entry, scoped to the focused conversation, and
	 * unsubscribe stragglers. Re-run on conversation switch: a conversation-scoped
	 * surface (e.g. cache-warming) re-scopes to the new id (`protocolSubscribe`
	 * emits unsubscribe-old + subscribe-new); a global surface ignores the id.
	 */
	function syncSubscriptions(): void {
		const cid = focusedConversationId();
		for (const entry of protocol.catalog) {
			const result = protocolSubscribe(protocol, entry.id, cid);
			protocol = result.state;
			for (const msg of result.outgoing) {
				socket?.send(msg);
			}
		}
		const catalogIds = new Set(protocol.catalog.map((e) => e.id));
		for (const id of [...protocol.subscriptions.keys()]) {
			if (!catalogIds.has(id)) {
				const result = protocolUnsubscribe(protocol, id);
				protocol = result.state;
				for (const msg of result.outgoing) {
					socket?.send(msg);
				}
			}
		}
	}

	let socket: ReturnType<typeof createSurfaceSocket> | null = null;

	const socketOpts: SurfaceSocketOptions = {
		url: wsUrl,
		onMessage: handleServerMessage,
		onChat: handleChatMessage,
		onReopen() {
			// The server forgot our subscriptions on reconnect; re-send each with the
			// conversation it was subscribed under (protocolSubscribe would no-op since
			// they're still in our local map, so emit the wire messages directly).
			for (const [surfaceId, sub] of protocol.subscriptions) {
				const msg: SubscribeMessage =
					sub.conversationId === undefined
						? { type: "subscribe", surfaceId }
						: { type: "subscribe", surfaceId, conversationId: sub.conversationId };
				socket?.send(msg);
			}
		},
	};
	if (opts?.socketFactory !== undefined) {
		socketOpts.socketFactory = opts.socketFactory;
	}
	socket = createSurfaceSocket(socketOpts);

	// Fetch model catalog
	void fetchImpl(`${httpBase}/models`)
		.then((res) => {
			if (!res.ok) return;
			return res.json() as Promise<ModelsResponse>;
		})
		.then((data) => {
			if (data === undefined) return;
			models = data.models;
			if (data.models.length > 0 && !data.models.includes(activeModel)) {
				const first = data.models[0];
				if (first !== undefined) {
					activeModel = first;
				}
			}
		})
		.catch(() => {
			// Model fetch failure is non-fatal; use defaults.
		});

	// Restore persisted tabs
	const persistedState = storageAdapter.load();
	if (persistedState !== null && persistedState.tabs.length > 0) {
		for (const tab of persistedState.tabs) {
			const store = createChatFor(tab.conversationId, tab.model);
			chatStores.set(tab.conversationId, store);
			void store.load();
		}
		if (persistedState.activeConversationId !== null) {
			const activeTab = persistedState.tabs.find(
				(t) => t.conversationId === persistedState.activeConversationId,
			);
			if (activeTab !== undefined) {
				activeModel = activeTab.model;
			}
		}
	}

	refreshActiveChat();

	return {
		get tabs(): readonly Tab[] {
			return tabsStore.tabs;
		},
		get activeConversationId(): string | null {
			return tabsStore.activeConversationId;
		},
		get activeChat(): ChatStore {
			return activeChat;
		},
		get models(): readonly string[] {
			return models;
		},
		get activeModel(): string {
			return activeModel;
		},
		get catalog() {
			return protocol.catalog;
		},
		get surfaces(): readonly SurfaceSpec[] {
			const out: SurfaceSpec[] = [];
			for (const entry of protocol.catalog) {
				const spec = getSurfaceSpec(protocol, entry.id);
				if (spec) out.push(spec);
			}
			return out;
		},
		get lastError() {
			return protocol.lastError;
		},

		surface(surfaceId: string): SurfaceSpec | null {
			return getSurfaceSpec(protocol, surfaceId);
		},

		send(text: string): void {
			if (tabsStore.activeConversationId === null) {
				// Draft: promote to tab on first send
				const conversationId = draftConversationId;
				const model = activeModel;
				tabsStore.createTab({
					conversationId,
					model,
					title: deriveTitle(text),
				});
				chatStores.set(conversationId, draftStore);
				void draftStore.load();

				// Prepare next draft
				const nextDraftId = randomId();
				draftStore = createChatFor(nextDraftId, activeModel);
				draftConversationId = nextDraftId;

				refreshActiveChat();
				// The draft became a real conversation: re-scope conversation-scoped
				// surfaces (e.g. cache-warming) to its id.
				syncSubscriptions();
				// Now send on the promoted store
				chatStores.get(conversationId)?.send(text);
			} else {
				activeChat.send(text);
			}
		},

		selectModel(model: string): void {
			activeModel = model;
			const activeId = tabsStore.activeConversationId;
			if (activeId !== null) {
				tabsStore.setModel(activeId, model);
				chatStores.get(activeId)?.setModel(model);
			} else {
				draftStore.setModel(model);
			}
		},

		newDraft(): void {
			tabsStore.newDraft();
			const nextDraftId = randomId();
			draftStore = createChatFor(nextDraftId, activeModel);
			draftConversationId = nextDraftId;
			refreshActiveChat();
			syncSubscriptions();
		},

		selectTab(conversationId: string): void {
			tabsStore.selectTab(conversationId);
			const tab = tabsStore.tabs.find((t) => t.conversationId === conversationId);
			if (tab !== undefined) {
				activeModel = tab.model;
			}
			refreshActiveChat();
			syncSubscriptions();
		},

		closeTab(conversationId: string): void {
			tabsStore.closeTab(conversationId);
			const store = chatStores.get(conversationId);
			if (store !== undefined) {
				store.dispose();
				chatStores.delete(conversationId);
			}
			void cache.delete(conversationId);
			refreshActiveChat();
			syncSubscriptions();
		},

		invoke(surfaceId: string, actionId: string, payload?: unknown): void {
			const result = protocolInvoke(
				protocol,
				surfaceId,
				actionId,
				payload,
				focusedConversationId(),
			);
			protocol = result.state;
			for (const msg of result.outgoing) {
				socket?.send(msg);
			}
		},

		async warmNow(): Promise<WarmResult | null> {
			const conversationId = tabsStore.activeConversationId;
			if (conversationId === null) return null;
			const body: WarmRequest = { conversationId, model: activeModel };
			try {
				const res = await fetchImpl(`${httpBase}/chat/warm`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return { ok: false, error: errBody?.error ?? `Warm failed (HTTP ${res.status})` };
				}
				return { ok: true, response: (await res.json()) as WarmResponse };
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : "Warm request failed" };
			}
		},
		dispose(): void {
			for (const store of chatStores.values()) {
				store.dispose();
			}
			chatStores.clear();
			draftStore.dispose();
			socket?.close();
			socket = null;
		},
	};
}
