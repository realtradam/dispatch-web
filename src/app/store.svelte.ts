import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	ConversationHistoryResponse,
	ConversationMetricsResponse,
	CwdResponse,
	LspStatusResponse,
	ModelsResponse,
	SetCwdRequest,
	WarmRequest,
	WarmResponse,
} from "@dispatch/transport-contract";
import type { SubscribeMessage, SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import { createIdbChunkStore } from "../adapters/idb";
import { createLocalStore } from "../adapters/local-storage";
import type { WebSocketLike } from "../adapters/ws";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../adapters/ws";
import { normalizeChatLimit } from "../core/chunks";
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

/** Outcome of `PUT /conversations/:id/cwd`. */
export type CwdResult =
	| { readonly ok: true; readonly cwd: string | null }
	| { readonly ok: false; readonly error: string };

/** Outcome of `GET /conversations/:id/lsp`. */
export type LspResult =
	| { readonly ok: true; readonly response: LspStatusResponse }
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
	/** The workspace conversation's persisted working directory, or null when unset. */
	readonly cwd: string | null;
	/** The conversation workspace settings target: the active tab, or the pending draft's id. */
	readonly currentConversationId: string;
	/**
	 * Set the workspace conversation's working directory (`PUT /conversations/:id/cwd`).
	 * Works for a draft too (its id survives promotion), so the first turn runs in it.
	 */
	setCwd(cwd: string): Promise<CwdResult | null>;
	/**
	 * Fetch the workspace conversation's language-server status (`GET /conversations/:id/lsp`).
	 * The backend lazily spawns servers, so this may take a moment on the first call for a cwd.
	 */
	lspStatus(): Promise<LspResult | null>;
	/**
	 * Wire the chat-limit unload gate (composition-root injection, called once by
	 * the shell after it owns the scroll region): unloading old chunks is allowed
	 * only while the gate returns true — i.e. the reader is stuck to the bottom —
	 * so a trim never yanks content out from under someone reading history.
	 * Before attachment unloading is allowed (the initial view starts at the
	 * bottom).
	 */
	attachUnloadGate(gate: () => boolean): void;
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

	// The chat limit (max loaded chunks per conversation) — a persisted local
	// setting with no UI yet: edit `localStorage["dispatch.chatLimit"]`. The
	// default is written back on first run so the knob is discoverable.
	const chatLimitStore = createLocalStore<number>("dispatch.chatLimit", {
		storage: localStorageOpt,
	});
	const storedChatLimit = chatLimitStore.load();
	const chatLimit = normalizeChatLimit(storedChatLimit);
	if (storedChatLimit === null) {
		chatLimitStore.save(chatLimit);
	}

	// Unload gate — attached by the shell once it owns the scroll region (see
	// `AppStore.attachUnloadGate`). Until then, unloading is allowed.
	let unloadGate: (() => boolean) | null = null;

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
			chatLimit,
			canUnload: () => (unloadGate === null ? true : unloadGate()),
		});
	}

	const initialDraftId = randomId();
	let draftStore: ChatStore = createChatFor(initialDraftId, activeModel);
	let draftConversationId: string = initialDraftId;

	let activeChat = $state<ChatStore>(draftStore as ChatStore);

	// The active conversation's persisted working directory (per-tab). Seeded from
	// the backend on focus change; null for a draft / when unset.
	let cwd = $state<string | null>(null);

	/** Refetch the workspace conversation's cwd into reactive state (works for a draft too). */
	async function refreshCwd(): Promise<void> {
		const id = workspaceConversationId();
		try {
			const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/cwd`);
			if (!res.ok) return;
			const data = (await res.json()) as CwdResponse;
			// Guard a slow response losing a race with a conversation switch.
			if (workspaceConversationId() === id) cwd = data.cwd ?? null;
		} catch {
			// Non-fatal: a cwd fetch failure just leaves the prior value.
		}
	}

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

	/**
	 * Start watching a conversation's live turn events (`chat.subscribe`). Sent for
	 * EVERY open conversation — not just the active one — so a backgrounded tab keeps
	 * streaming a running turn, and a reloaded/second client re-attaches to an
	 * in-flight turn (the server replays it from `turn-start`). Idempotent server-side;
	 * the socket queues it until the connection is open. NOT needed right after
	 * `chat.send` (that auto-subscribes the sending connection).
	 */
	function subscribeChat(conversationId: string): void {
		socket?.send({ type: "chat.subscribe", conversationId });
	}

	/** Stop watching a conversation's turn events (`chat.unsubscribe`). Never stops the turn. */
	function unsubscribeChat(conversationId: string): void {
		socket?.send({ type: "chat.unsubscribe", conversationId });
	}

	/**
	 * Tell the backend the user EXPLICITLY closed this conversation's tab
	 * (`POST /conversations/:id/close`): aborts any in-flight turn (it seals with
	 * `reason: "aborted"`) and stops + DISABLES its cache-warming (persisted OFF).
	 * Distinct from a disconnect / `chat.unsubscribe`, which deliberately leave
	 * both running. Fire-and-forget: a failure is non-fatal (worst case the
	 * warming keeps running until a later close/toggle), and the endpoint is
	 * idempotent server-side.
	 */
	function closeConversation(conversationId: string): void {
		void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(conversationId)}/close`, {
			method: "POST",
		}).catch(() => {
			// Non-fatal — see doc comment.
		});
	}

	/** The conversation the surfaces should scope to (undefined for a draft). */
	function focusedConversationId(): string | undefined {
		return tabsStore.activeConversationId ?? undefined;
	}

	/**
	 * The conversation id workspace settings (cwd / LSP) target: the active tab, or
	 * the pending draft's id when in draft mode. Unlike `focusedConversationId`, this
	 * is NEVER undefined — the draft has a stable client-minted id that survives
	 * promotion (first send), so a cwd set on a draft carries into the real turn.
	 */
	function workspaceConversationId(): string {
		return tabsStore.activeConversationId ?? draftConversationId;
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
			// A GLOBAL surface ignores conversation scope — subscribe it WITHOUT an id
			// so a conversation switch doesn't churn a redundant unsubscribe+subscribe
			// round trip (ui-contract@0.2.0 catalog `scope`; ABSENT = assume
			// conversation-scoped, the conservative pre-0.2.0 policy).
			const scoped = entry.scope === "global" ? undefined : cid;
			const result = protocolSubscribe(protocol, entry.id, scoped);
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
			// Re-attach to every open conversation's turn stream. A turn that kept
			// running while we were disconnected resumes streaming (server replays it
			// from `turn-start`); one that sealed while we were gone is committed from
			// history by `resync()` (which also clears a now-stale "generating").
			for (const tab of tabsStore.tabs) {
				subscribeChat(tab.conversationId);
				chatStores.get(tab.conversationId)?.resync();
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
			// Watch each restored conversation's live turns: after a reload mid-turn the
			// server replays the in-flight turn so we keep rendering it. Queued until the
			// socket opens.
			subscribeChat(tab.conversationId);
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
	void refreshCwd();

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
		get cwd(): string | null {
			return cwd;
		},
		get currentConversationId(): string {
			return workspaceConversationId();
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
				void refreshCwd();
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
			void refreshCwd();
		},

		selectTab(conversationId: string): void {
			tabsStore.selectTab(conversationId);
			const tab = tabsStore.tabs.find((t) => t.conversationId === conversationId);
			if (tab !== undefined) {
				activeModel = tab.model;
			}
			refreshActiveChat();
			syncSubscriptions();
			void refreshCwd();
		},

		closeTab(conversationId: string): void {
			tabsStore.closeTab(conversationId);
			// The user is DONE with this chat for now: abort any in-flight turn and
			// stop + disable its cache-warming, server-side.
			closeConversation(conversationId);
			// Stop watching the closed conversation's turns.
			unsubscribeChat(conversationId);
			const store = chatStores.get(conversationId);
			if (store !== undefined) {
				store.dispose();
				chatStores.delete(conversationId);
			}
			void cache.delete(conversationId);
			refreshActiveChat();
			syncSubscriptions();
			void refreshCwd();
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

		async setCwd(value: string): Promise<CwdResult | null> {
			const id = workspaceConversationId();
			const body: SetCwdRequest = { cwd: value };
			try {
				const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/cwd`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return { ok: false, error: errBody?.error ?? `Set cwd failed (HTTP ${res.status})` };
				}
				const data = (await res.json()) as CwdResponse;
				const next = data.cwd ?? null;
				if (workspaceConversationId() === id) cwd = next;
				return { ok: true, cwd: next };
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : "Set cwd request failed" };
			}
		},

		async lspStatus(): Promise<LspResult | null> {
			const id = workspaceConversationId();
			try {
				const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/lsp`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return { ok: false, error: errBody?.error ?? `LSP status failed (HTTP ${res.status})` };
				}
				// Normalize the untyped body at this network seam so a malformed/partial
				// response can never crash the renderer (servers is guaranteed an array).
				const data = (await res.json()) as Partial<LspStatusResponse>;
				const response: LspStatusResponse = {
					conversationId: data.conversationId ?? id,
					cwd: data.cwd ?? null,
					servers: Array.isArray(data.servers) ? data.servers : [],
				};
				return { ok: true, response };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "LSP status request failed",
				};
			}
		},
		attachUnloadGate(gate: () => boolean): void {
			unloadGate = gate;
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
