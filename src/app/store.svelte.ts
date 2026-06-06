import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	ConversationHistoryResponse,
	ModelsResponse,
} from "@dispatch/transport-contract";
import type { SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import { createIdbChunkStore } from "../adapters/idb";
import { createLocalStore } from "../adapters/local-storage";
import type { WebSocketLike } from "../adapters/ws";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../adapters/ws";
import {
	applyServerMessage,
	type ProtocolState,
	initialState as protocolInitialState,
	invoke as protocolInvoke,
	subscribe as protocolSubscribe,
	unsubscribe as protocolUnsubscribe,
} from "../core/protocol";
import type { ChatStore } from "../features/chat";
import { createChatStore } from "../features/chat";
import type { ConversationCache } from "../features/conversation-cache";
import { createConversationCache } from "../features/conversation-cache";
import type { Tab, TabsState } from "../features/tabs";
import { createTabsStore, deriveTitle, type TabsStore } from "../features/tabs";
import { resolveHttpUrl } from "./resolve-http-url";
import { resolveWsUrl } from "./resolve-ws-url";
import { randomId } from "./uuid";

const DEFAULT_MODEL = "opencode/deepseek-v4-flash";

export interface AppStore {
	readonly tabs: readonly Tab[];
	readonly activeConversationId: string | null;
	readonly activeChat: ChatStore;
	readonly models: readonly string[];
	readonly activeModel: string;
	readonly catalog: ProtocolState["catalog"];
	readonly selectedId: string | null;
	readonly selectedSpec: SurfaceSpec | null;
	readonly lastError: ProtocolState["lastError"];
	send(text: string): void;
	selectModel(model: string): void;
	newDraft(): void;
	selectTab(conversationId: string): void;
	closeTab(conversationId: string): void;
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

export function createAppStore(opts?: CreateAppStoreOptions): AppStore {
	let protocol = $state<ProtocolState>(protocolInitialState());
	let selectedId = $state<string | null>(null);
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
	const localStorageOpt = opts?.localStorage;

	const storageAdapter = createLocalStore<TabsState>("dispatch.tabs", {
		storage: localStorageOpt,
	});
	const tabsStore: TabsStore = createTabsStore(storageAdapter);

	const cache: ConversationCache = createConversationCache(
		createIdbChunkStore({ indexedDB: indexedDBFactory }),
	);

	const historySync = createHistorySync(httpBase, fetchImpl);

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

	function handleServerMessage(msg: SurfaceServerMessage): void {
		protocol = applyServerMessage(protocol, msg);
	}

	let socket: ReturnType<typeof createSurfaceSocket> | null = null;

	const socketOpts: SurfaceSocketOptions = {
		url: wsUrl,
		onMessage: handleServerMessage,
		onChat: handleChatMessage,
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
		},

		selectTab(conversationId: string): void {
			tabsStore.selectTab(conversationId);
			const tab = tabsStore.tabs.find((t) => t.conversationId === conversationId);
			if (tab !== undefined) {
				activeModel = tab.model;
			}
			refreshActiveChat();
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
