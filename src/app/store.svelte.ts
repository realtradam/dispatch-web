import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	CompactPercentResponse,
	CompactResponse,
	ComputerListResponse,
	ComputerStatusResponse,
	ConversationCompactedMessage,
	ConversationComputerResponse,
	ConversationHistoryResponse,
	ConversationListResponse,
	ConversationMetricsResponse,
	ConversationOpenMessage,
	ConversationStatusChangedMessage,
	CwdResponse,
	LspStatusResponse,
	McpStatusResponse,
	ModelMetadata,
	ModelResponse,
	ModelsResponse,
	ReasoningEffort,
	ReasoningEffortResponse,
	SetCompactPercentRequest,
	SetConversationComputerRequest,
	SetCwdRequest,
	SetModelRequest,
	SetReasoningEffortRequest,
	SetSystemPromptTemplateRequest,
	SetTitleRequest,
	SystemPromptTemplateResponse,
	SystemPromptVariable,
	SystemPromptVariablesResponse,
	TestComputerResponse,
	WarmRequest,
	WarmResponse,
} from "@dispatch/transport-contract";
import type { SubscribeMessage, SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import type { ComputerEntry, ConversationStatus } from "@dispatch/wire";
import { untrack } from "svelte";
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
import type { ChatStore, HistorySync, MetricsSync } from "../features/chat";
import { createChatStore } from "../features/chat";
import type { ConversationCache } from "../features/conversation-cache";
import { createConversationCache } from "../features/conversation-cache";
import type {
	HeartbeatConfig,
	HeartbeatConfigPatch,
	HeartbeatConfigResult,
	HeartbeatNextRunResult,
	HeartbeatRun,
	HeartbeatRunsResult,
	HeartbeatStopResult,
} from "../features/heartbeat";
import { normalizeHeartbeatConfig, normalizeHeartbeatRuns } from "../features/heartbeat";
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

/** Outcome of `PUT /conversations/:id/computer` (set/clear the per-conversation computer). */
export type ComputerResult =
	| { readonly ok: true; readonly computerId: string | null }
	| { readonly ok: false; readonly error: string };

/** Outcome of `GET /computers/:alias/status` (the live connection state). */
export type ComputerStatusResult =
	| { readonly ok: true; readonly response: ComputerStatusResponse }
	| { readonly ok: false; readonly error: string };

/** Outcome of `POST /computers/:alias/test` (one-shot connectivity probe). */
export type TestComputerResult =
	| { readonly ok: true; readonly response: TestComputerResponse }
	| { readonly ok: false; readonly error: string };

/** Outcome of `GET /conversations/:id/lsp`. */
export type LspResult =
	| { readonly ok: true; readonly response: LspStatusResponse }
	| { readonly ok: false; readonly error: string };

/** Outcome of `GET /conversations/:id/mcp`. */
export type McpResult =
	| { readonly ok: true; readonly response: McpStatusResponse }
	| { readonly ok: false; readonly error: string };

/** Outcome of `PUT /conversations/:id/reasoning-effort`. */
export type ReasoningEffortResult =
	| { readonly ok: true; readonly reasoningEffort: ReasoningEffort }
	| { readonly ok: false; readonly error: string };

/** Outcome of `POST /conversations/:id/compact` (manual compaction). */
export type CompactResult =
	| { readonly ok: true; readonly response: CompactResponse }
	| { readonly ok: false; readonly error: string };

/** Outcome of `PUT /conversations/:id/compact-percent`. */
export type CompactPercentResult =
	| { readonly ok: true; readonly percent: number }
	| { readonly ok: false; readonly error: string };

/** Outcome of `GET /system-prompt` (global template load). */
export type SystemPromptLoadResult =
	| { readonly ok: true; readonly template: string }
	| { readonly ok: false; readonly error: string };

/** Outcome of `PUT /system-prompt` (global template save). */
export type SystemPromptSaveResult = SystemPromptLoadResult;

/** Outcome of `GET /system-prompt/variables` (variable catalog). */
export type SystemPromptVariablesResult =
	| { readonly ok: true; readonly variables: readonly SystemPromptVariable[] }
	| { readonly ok: false; readonly error: string };

/** Outcome of persisting a chat-limit setting (localStorage; FE-local). */
export type ChatLimitResult =
	| { readonly ok: true; readonly chatLimit: number }
	| { readonly ok: false; readonly error: string };

export interface AppStore {
	readonly tabs: readonly Tab[];
	readonly activeConversationId: string | null;
	/** The workspace currently in view (URL slug); tabs are filtered to it. */
	readonly activeWorkspaceId: string;
	readonly activeChat: ChatStore;
	readonly models: readonly string[];
	/** Per-model metadata (contextWindow, etc.) from `GET /models`. */
	readonly modelInfo: Readonly<Record<string, ModelMetadata>>;
	readonly activeModel: string;
	readonly catalog: ProtocolState["catalog"];
	/** Every received surface spec, in catalog order — all auto-subscribed + expanded. */
	readonly surfaces: readonly SurfaceSpec[];
	readonly lastError: ProtocolState["lastError"];
	/** The localStorage instance the store uses for persistence (tabs, chatLimit).
	 *  Exposed so the shell can persist sidebar layout via the same adapter. */
	readonly storage: Storage | undefined;
	/** The current spec for one surface by id (discovery-by-id), or null if absent. */
	surface(surfaceId: string): SurfaceSpec | null;
	send(text: string): void;
	/**
	 * Enqueue a steering message onto the focused conversation's queue
	 * (`chat.queue` WS op). While a turn is generating, the message is delivered
	 * mid-turn at the next tool-result boundary; when idle, the server
	 * auto-starts a turn (equivalent to `send`). Safe to offer whenever the user
	 * wants to add input — the server owns the idle-vs-generating decision.
	 */
	queueMessage(text: string): void;
	selectModel(model: string): void;
	newDraft(): void;
	/** Switch the active workspace (on route change) + reset to a fresh draft in it. */
	setActiveWorkspace(workspaceId: string): void;
	selectTab(conversationId: string): void;
	closeTab(conversationId: string): void;
	renameTab(conversationId: string, title: string): void;
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
	 * The workspace conversation's persisted computer (an SSH `Host` alias), or
	 * null when never set / local. Seeded from the backend on focus change.
	 */
	readonly computerId: string | null;
	/**
	 * Persist the workspace conversation's computer (`PUT /conversations/:id/computer`).
	 * Pass null to clear → the conversation inherits the workspace default → local.
	 * Works for a draft too (its id survives promotion). Not seen by the agent — a
	 * user-facing tool-execution target only.
	 */
	setComputer(computerId: string | null): Promise<ComputerResult | null>;
	/**
	 * Every remote computer discovered from the user's `~/.ssh/config`
	 * (`GET /computers`), fetched on boot. Read-only — there is no Computer CRUD
	 * (the user edits their ssh config to add one). Empty until the `ssh`
	 * extension lands.
	 */
	readonly computers: readonly ComputerEntry[];
	/**
	 * The live connection state of a computer (`GET /computers/:alias/status`):
	 * whether Dispatch currently holds an open SSH session to it. Returns null
	 * only if no alias is given (the focused conversation is local). Polled by the
	 * `ComputerField` while a computer is selected.
	 */
	computerStatus(alias: string): Promise<ComputerStatusResult | null>;
	/**
	 * One-shot connectivity probe (`POST /computers/:alias/test`): Dispatch opens
	 * an SSH connection to the alias, runs a trivial command, then closes. `ok` is
	 * true on success; `error` carries the failure reason otherwise.
	 */
	testComputer(alias: string): Promise<TestComputerResult | null>;
	/**
	 * The workspace conversation's persisted reasoning effort, or null when never
	 * set (the server then resolves turns at the default, `"high"`).
	 */
	readonly reasoningEffort: ReasoningEffort | null;
	/**
	 * Persist the workspace conversation's reasoning effort
	 * (`PUT /conversations/:id/reasoning-effort`). Works for a draft too (its id
	 * survives promotion), so the first turn already runs at the chosen level.
	 * Takes effect from the NEXT turn; resolution stays server-owned.
	 */
	setReasoningEffort(level: ReasoningEffort): Promise<ReasoningEffortResult | null>;
	/**
	 * Manually trigger conversation compaction (`POST /conversations/:id/compact`).
	 * Summarizes old messages + retains the most recent N. Returns null when no
	 * conversation is focused (a draft has nothing to compact).
	 */
	compactNow(keepLastN?: number): Promise<CompactResult | null>;
	/**
	 * Stop an in-flight generation (`POST /conversations/:id/stop`). Aborts the
	 * turn without closing the conversation — partial messages are persisted, the
	 * turn seals with `reason: "aborted"`, and the conversation goes `active → idle`.
	 * Returns null when no conversation is focused.
	 */
	stopGeneration(): void;
	/**
	 * The workspace conversation's auto-compact percent (0-100). `0` = disabled
	 * (manual only); a positive number = auto-compact triggers when the last
	 * turn's input tokens exceed it. Seeded from the backend on focus change.
	 */
	readonly compactPercent: number | null;
	/**
	 * Persist the workspace conversation's auto-compact percent
	 * (`PUT /conversations/:id/compact-percent`). `0` disables; 1-100 sets the
	 * trigger percentage of the model's context window. Default (null) is 85.
	 * number enables. Works for a draft too (its id survives promotion).
	 */
	setCompactPercent(percent: number): Promise<CompactPercentResult | null>;
	/**
	 * Fetch the workspace conversation's language-server status (`GET /conversations/:id/lsp`).
	 * The backend lazily spawns servers, so this may take a moment on the first call for a cwd.
	 */
	lspStatus(): Promise<LspResult | null>;
	/**
	 * Fetch the workspace conversation's MCP server status (`GET /conversations/:id/mcp`).
	 * Mirrors the LSP status endpoint: returns `{cwd, servers}` with empty `servers`
	 * when no cwd is set; the backend lazily connects servers, so this may take a
	 * moment on the first call for a cwd.
	 */
	mcpStatus(): Promise<McpResult | null>;
	/**
	 * Load the global system prompt template (`GET /system-prompt`). The template is
	 * conversation-agnostic; it is resolved once per conversation on first turn and
	 * persisted for prompt-cache safety.
	 */
	loadSystemPrompt(): Promise<SystemPromptLoadResult>;
	/**
	 * Persist the global system prompt template (`PUT /system-prompt`). Changes apply
	 * to new conversations on their first turn; existing conversations keep their
	 * resolved system prompt until compaction.
	 */
	setSystemPrompt(template: string): Promise<SystemPromptSaveResult>;
	/**
	 * Load the static catalog of available system prompt variables (`GET /system-prompt/variables`).
	 * Used by the builder to render the variable selector buttons.
	 */
	loadSystemPromptVariables(): Promise<SystemPromptVariablesResult>;
	/** The persisted chat limit (max loaded chunks per conversation). */
	readonly chatLimit: number;
	/**
	 * A conversation's backend lifecycle status (`active`/`idle`/`closed`), or
	 * `undefined` when unknown. Drives the tab-bar generating indicator
	 * (cross-device: a tab spinning because another device's turn is running).
	 */
	conversationStatus(conversationId: string): ConversationStatus | undefined;
	/**
	 * Persist + live-apply a new chat limit: writes `dispatch.chatLimit` to
	 * localStorage and propagates to every live chat store (trim if lower,
	 * deferred via the unload gate while a reader is scrolled up; no-op if
	 * higher — page unloaded history back in via "Show earlier"). Stores created
	 * afterwards pick the new limit up at creation. Always succeeds (FE-local).
	 */
	setChatLimit(limit: number): Promise<ChatLimitResult>;
	/**
	 * Wire the chat-limit unload gate (composition-root injection, called once by
	 * the shell after it owns the scroll region): unloading old chunks is allowed
	 * only while the gate returns true — i.e. the reader is stuck to the bottom —
	 * so a trim never yanks content out from under someone reading history.
	 * Before attachment unloading is allowed (the initial view starts at the
	 * bottom).
	 */
	attachUnloadGate(gate: () => boolean): void;
	/**
	 * Load the active workspace's heartbeat config
	 * (`GET /workspaces/:id/heartbeat`). Workspace-scoped (NOT per-conversation):
	 * the backend runs an autonomous agent loop on a configured interval, writing
	 * each run into a dedicated conversation. The config covers the system/task
	 * prompts, model, reasoning effort, interval, and an enabled flag.
	 */
	heartbeatConfig(): Promise<HeartbeatConfigResult>;
	/**
	 * Persist a partial heartbeat config patch
	 * (`PUT /workspaces/:id/heartbeat`). The backend merges the patch onto the
	 * stored config; returns the full updated config.
	 */
	setHeartbeatConfig(patch: HeartbeatConfigPatch): Promise<HeartbeatConfigResult>;
	/**
	 * Load the active workspace's heartbeat run history
	 * (`GET /workspaces/:id/heartbeat/runs`). Each run references the conversation
	 * it wrote to — open one via {@link watchConversation} to see its chat live.
	 */
	heartbeatRuns(): Promise<HeartbeatRunsResult>;
	/**
	 * Stop a running heartbeat run (`POST /workspaces/:id/heartbeat/runs/:runId/stop`).
	 * The run's in-flight turn seals (its conversation keeps streaming until it
	 * ends); the run's status flips to `stopped` (visible on the next runs poll).
	 */
	stopHeartbeatRun(runId: string): Promise<HeartbeatStopResult>;
	/**
	 * Fetch the server-authoritative next-run timestamp
	 * (`GET /workspaces/:id/heartbeat/next-run`) — when the next heartbeat run
	 * will fire (ISO 8601), or null when disabled / no run scheduled. The FE shows
	 * a live countdown from this. When the endpoint is absent (404 — backend
	 * hasn't shipped CR-HB-3 yet) it returns `ok: false` so the FE falls back to
	 * an approximation from the runs + config.
	 */
	heartbeatNextRun(): Promise<HeartbeatNextRunResult>;
	/**
	 * Open a "watch" on a conversation for a modal viewer (the heartbeat run-chat
	 * modal): ensures a live {@link ChatStore} for the conversation, subscribing
	 * to its turn stream (`chat.subscribe`) + loading history. Reuses the open
	 * tab's store if the conversation is already a tab; otherwise creates an
	 * EPHEMERAL watch store (separate from tabs — never opens a tab). Deltas are
	 * routed to it automatically. Pair every open with {@link unwatchConversation}
	 * on close to unsubscribe + dispose the ephemeral store.
	 */
	watchConversation(conversationId: string): ChatStore;
	/** Dispose + unsubscribe a watch opened by {@link watchConversation}. */
	unwatchConversation(conversationId: string): void;
	/**
	 * A critical error that blocks normal operation (e.g. the cross-device tab
	 * restore fetch failed). When non-null, a full-screen modal is shown with the
	 * error details. Cleared by `clearFatalError` (the modal's dismiss button).
	 */
	readonly fatalError: string | null;
	/** Dismiss the fatal error (called by the error modal's X button). */
	clearFatalError(): void;
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
	/** The workspace to scope to at boot (its URL slug); "default" if absent. */
	workspaceId?: string;
}

function createHistorySync(httpBase: string, fetchImpl: typeof fetch): HistorySync {
	return async (conversationId, sinceSeq, window) => {
		let url = `${httpBase}/conversations/${encodeURIComponent(conversationId)}?sinceSeq=${sinceSeq}`;
		// CR-5 windowing (transport-contract@0.10.0): both must be positive
		// integers when present (the server 400s otherwise; callers guarantee it).
		if (window?.limit !== undefined) url += `&limit=${window.limit}`;
		if (window?.beforeSeq !== undefined) url += `&beforeSeq=${window.beforeSeq}`;
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
	let modelInfo = $state<Readonly<Record<string, ModelMetadata>>>({});
	// Discovered SSH computers (`GET /computers`). Global (like `models`); empty
	// until the `ssh` extension lands. Read-only — no CRUD (the user edits their
	// `~/.ssh/config`).
	let computers = $state<readonly ComputerEntry[]>([]);
	let activeModel = $state(DEFAULT_MODEL);
	let fatalError = $state<string | null>(null);

	// The workspace currently in view (its URL slug); "default" until routing
	// sets it. Tabs are filtered to this workspace; a new conversation is stamped
	// with it on `chat.send`.
	let activeWorkspaceId = $state<string>(opts?.workspaceId ?? "default");

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
	// setting surfaced in the sidebar's Settings view. Reactive so the field +
	// any live-apply re-trim update together. The default is written back on
	// first run so the knob is discoverable in localStorage too.
	const chatLimitStore = createLocalStore<number>("dispatch.chatLimit", {
		storage: localStorageOpt,
	});
	const storedChatLimit = chatLimitStore.load();
	const normalizedChatLimit = normalizeChatLimit(storedChatLimit);
	let chatLimit = $state(normalizedChatLimit);
	if (storedChatLimit === null) {
		chatLimitStore.save(normalizedChatLimit);
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

	// Ephemeral chat stores for MODAL viewers (the heartbeat run-chat modal): a
	// watch on a conversation's live turn stream WITHOUT opening a tab. Separate
	// from `chatStores` (tabs) so closing a modal never disturbs the tab strip,
	// and a tab's conversation reuses its own store (see `watchConversation`).
	// Deltas are routed here in addition to `chatStores`.
	const watchStores = new Map<string, ChatStore>();

	function createChatFor(conversationId: string, model: string, workspaceId: string): ChatStore {
		return createChatStore({
			conversationId,
			model,
			workspaceId,
			transport: {
				send(msg) {
					socket?.send(msg);
				},
			},
			historySync,
			metricsSync,
			cache,
			// Read from the persisted store (kept in sync with the reactive `chatLimit`
			// by `setChatLimit` + boot) so this snapshot doesn't reference the `$state`
			// — each store captures its limit at creation; live updates go through
			// `setChatLimit`.
			chatLimit: normalizeChatLimit(chatLimitStore.load()),
			canUnload: () => (unloadGate === null ? true : unloadGate()),
			onError: (context, err) => {
				reportError(`${context} (conversation: ${conversationId})`, err);
			},
		});
	}

	const initialDraftId = randomId();
	// Read `activeWorkspaceId` with untrack to suppress Svelte's
	// `state_referenced_locally` warning — this intentionally captures the
	// INITIAL workspace for the boot draft. When the workspace changes later,
	// `setActiveWorkspace` creates a fresh draft store with the new id.
	let draftStore: ChatStore = createChatFor(
		initialDraftId,
		DEFAULT_MODEL,
		untrack(() => activeWorkspaceId),
	);
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
		} catch (err) {
			reportError("Failed to load working directory", err);
		}
	}

	// The active conversation's persisted computer (SSH Host alias). Seeded on
	// focus change; null = local / never set (inherits the workspace default).
	let computerId = $state<string | null>(null);

	/**
	 * Refetch the workspace conversation's persisted computer into reactive state
	 * (works for a draft too). A draft's id 404s until promoted; `res.ok` is false
	 * so it is a silent no-op (mirrors `refreshCwd` for a draft).
	 */
	async function refreshComputer(): Promise<void> {
		const id = workspaceConversationId();
		// Clear immediately so a switch never shows the PREVIOUS conversation's
		// computer while the fetch is in flight (null renders as "Local").
		computerId = null;
		try {
			const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/computer`);
			if (!res.ok) return;
			const data = (await res.json()) as ConversationComputerResponse;
			// Guard a slow response losing a race with a conversation switch.
			if (workspaceConversationId() === id) computerId = data.computerId ?? null;
		} catch (err) {
			reportError("Failed to load computer", err);
		}
	}

	/** Refetch the workspace conversation's persisted model (works for a draft too). */
	async function refreshModel(): Promise<void> {
		const id = workspaceConversationId();
		try {
			const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/model`);
			if (!res.ok) return;
			const data = (await res.json()) as ModelResponse;
			if (workspaceConversationId() !== id) return;
			if (typeof data.model === "string" && data.model.length > 0) {
				activeModel = data.model;
				const activeId = tabsStore.activeConversationId;
				if (activeId !== null) {
					tabsStore.setModel(activeId, data.model);
					chatStores.get(activeId)?.setModel(data.model);
				} else {
					draftStore.setModel(data.model);
				}
			}
		} catch (err) {
			reportError("Failed to load model", err);
		}
	}

	// The workspace conversation's persisted reasoning effort. Seeded from the
	// backend on focus change; null = never set (the server default applies).
	let reasoningEffort = $state<ReasoningEffort | null>(null);

	/** Refetch the workspace conversation's reasoning effort (works for a draft too). */
	async function refreshReasoningEffort(): Promise<void> {
		const id = workspaceConversationId();
		// Clear immediately so a switch never shows the PREVIOUS conversation's level
		// while the fetch is in flight (null renders as the server default).
		reasoningEffort = null;
		try {
			const res = await fetchImpl(
				`${httpBase}/conversations/${encodeURIComponent(id)}/reasoning-effort`,
			);
			if (!res.ok) return;
			const data = (await res.json()) as ReasoningEffortResponse;
			// Guard a slow response losing a race with a conversation switch.
			if (workspaceConversationId() === id) reasoningEffort = data.reasoningEffort ?? null;
		} catch (err) {
			reportError("Failed to load reasoning effort", err);
		}
	}

	// The workspace conversation's auto-compact percent. Seeded from the
	// backend on focus change; null = not yet fetched. 0 = disabled.
	let compactPercent = $state<number | null>(null);

	/** Refetch the workspace conversation's compact percent (works for a draft too). */
	async function refreshCompactPercent(): Promise<void> {
		const id = workspaceConversationId();
		compactPercent = null;
		try {
			const res = await fetchImpl(
				`${httpBase}/conversations/${encodeURIComponent(id)}/compact-percent`,
			);
			if (!res.ok) return;
			const data = (await res.json()) as CompactPercentResponse;
			if (workspaceConversationId() === id) compactPercent = data.threshold;
		} catch (err) {
			reportError("Failed to load compact percent", err);
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
			const store = chatStores.get(targetId) ?? watchStores.get(targetId);
			if (store !== undefined) {
				store.handleDelta(msg);
				return;
			}
		}

		// fallback: try all stores (chat.error without conversationId)
		for (const store of chatStores.values()) {
			store.handleDelta(msg);
		}
		for (const store of watchStores.values()) {
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
	 * Open a "watch" on a conversation for a modal viewer (the heartbeat run-chat
	 * modal). Returns a live {@link ChatStore} for the conversation's turn stream.
	 * If the conversation is already an open TAB, reuses its store (it is already
	 * subscribed + streaming); otherwise creates an EPHEMERAL watch store in
	 * `watchStores` (separate from tabs — never opens a tab), subscribes to its
	 * live turn stream, and loads history. Deltas route to it via `handleChatMessage`.
	 * Pair with {@link unwatchConversation} on close.
	 */
	function watchConversation(conversationId: string): ChatStore {
		// An open tab already has a live store + subscription — reuse it.
		const tabStore = chatStores.get(conversationId);
		if (tabStore !== undefined) return tabStore;
		const existing = watchStores.get(conversationId);
		if (existing !== undefined) return existing;
		const store = createChatFor(conversationId, activeModel, activeWorkspaceId);
		watchStores.set(conversationId, store);
		void store.load();
		subscribeChat(conversationId);
		return store;
	}

	/**
	 * Dispose + unsubscribe a watch opened by {@link watchConversation}. A no-op if
	 * the conversation was (or became) an open TAB — the tab owns its store +
	 * subscription, so nothing is torn down (closing the modal must not disturb the
	 * tab strip). Only the ephemeral watch store is disposed + unsubscribed.
	 */
	function unwatchConversation(conversationId: string): void {
		// A tab reuses its own store — leave it (and its subscription) intact.
		if (chatStores.has(conversationId)) return;
		const store = watchStores.get(conversationId);
		if (store === undefined) return;
		store.dispose();
		watchStores.delete(conversationId);
		unsubscribeChat(conversationId);
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
		}).catch((err) => {
			reportError("Failed to close conversation", err);
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

	/**
	 * Open a conversation tab — used by the `conversation.open` WS broadcast
	 * (CLI `--open` flag) and by `conversation.statusChanged` when a new active
	 * conversation is discovered. If the conversation is already open, this is a
	 * no-op; otherwise create a chat store, load its history, subscribe to its live
	 * turns, and add the tab WITHOUT switching the active conversation (the user
	 * stays on their current tab; the new tab appears in the strip). The tab is
	 * stamped with the conversation's actual `workspaceId`, NOT the viewer's
	 * currently active workspace.
	 */
	function openConversation(conversationId: string, workspaceId: string): void {
		if (chatStores.has(conversationId)) return;
		const store = createChatFor(conversationId, activeModel, workspaceId);
		chatStores.set(conversationId, store);
		void store.load();
		subscribeChat(conversationId);
		tabsStore.openTab({
			conversationId,
			model: activeModel,
			title: "Conversation",
			workspaceId,
		});
	}

	/**
	 * Remove a tab + its chat store locally (NO `POST /close` — used when the
	 * backend already marked the conversation `closed` via `conversation.statusChanged`).
	 */
	function removeTabLocally(conversationId: string): void {
		unsubscribeChat(conversationId);
		const store = chatStores.get(conversationId);
		if (store !== undefined) {
			store.dispose();
			chatStores.delete(conversationId);
		}
		void cache.delete(conversationId);
		tabsStore.closeTab(conversationId);
		conversationStatuses.delete(conversationId);
		refreshActiveChat();
		syncSubscriptions();
		void refreshCwd();
		void refreshComputer();
		void refreshReasoningEffort();
		void refreshCompactPercent();
	}

	/**
	 * Surface a swallowed error to the user via the full-screen error modal
	 * (`fatalError` → `ErrorModal`). Logs to `console.error` too so the stack is
	 * in devtools. Called from catch blocks that previously swallowed errors silently.
	 */
	function reportError(context: string, err: unknown): void {
		console.error(`[reportError] ${context}`, err);
		const detail =
			err instanceof Error
				? `${err.name}: ${err.message}\n\n${err.stack ?? "(no stack trace available)"}`
				: String(err);
		fatalError = `${context}\n\n${detail}`;
	}

	// Conversation lifecycle status (backend-owned, pushed via WS +
	// fetched on connect). Keyed by conversationId.
	let conversationStatuses = $state<Map<string, ConversationStatus>>(new Map());

	/**
	 * Fetch `GET /conversations?status=active,idle` on connect to restore the
	 * tab bar across devices. Merges: opens tabs for conversations not already
	 * open, removes tabs for conversations that are no longer active/idle
	 * (closed on another device), and subscribes to `active` conversations'
	 * live streams.
	 */
	async function fetchOpenConversations(): Promise<void> {
		try {
			const res = await fetchImpl(`${httpBase}/conversations?status=active,idle`);
			if (!res.ok) return;
			const data = (await res.json()) as ConversationListResponse;

			// Update the status map from the authoritative backend list.
			const newStatuses = new Map<string, ConversationStatus>();
			for (const conv of data.conversations) {
				newStatuses.set(conv.id, conv.status);
			}
			conversationStatuses = newStatuses;

			// Open tabs for conversations not already open.
			const existingIds = new Set(chatStores.keys());
			for (const conv of data.conversations) {
				if (!existingIds.has(conv.id)) {
					const store = createChatFor(conv.id, activeModel, conv.workspaceId);
					chatStores.set(conv.id, store);
					void store.load();
					subscribeChat(conv.id);
					tabsStore.openTab({
						conversationId: conv.id,
						model: activeModel,
						title: conv.title,
						workspaceId: conv.workspaceId,
					});
				} else {
					// Already open — update the title from the backend if it differs.
					tabsStore.setTitle(conv.id, conv.title);
				}
			}

			// Remove tabs for conversations no longer active/idle (closed elsewhere).
			const backendIds = new Set(data.conversations.map((c) => c.id));
			for (const tab of tabsStore.tabs) {
				if (!backendIds.has(tab.conversationId)) {
					removeTabLocally(tab.conversationId);
				}
			}
		} catch (err) {
			reportError(
				`Failed to load conversations from the backend.\n\nURL: ${httpBase}/conversations?status=active,idle`,
				err,
			);
		}
	}

	const socketOpts: SurfaceSocketOptions = {
		url: wsUrl,
		onMessage: handleServerMessage,
		onChat: handleChatMessage,
		onConversationOpen(msg: ConversationOpenMessage): void {
			openConversation(msg.conversationId, msg.workspaceId);
		},
		onConversationStatusChanged(msg: ConversationStatusChangedMessage): void {
			const { conversationId, status, workspaceId } = msg;
			if (status === "closed") {
				// Closed on another device (or the backend) — remove the tab locally.
				if (chatStores.has(conversationId)) {
					removeTabLocally(conversationId);
				}
				return;
			}
			// active / idle — update the status map (drives the tab spinner).
			conversationStatuses = new Map(conversationStatuses).set(conversationId, status);
			// If this is a new active conversation we don't have a tab for, open one.
			if (status === "active" && !chatStores.has(conversationId)) {
				openConversation(conversationId, workspaceId);
			}
		},
		onConversationCompacted(msg: ConversationCompactedMessage): void {
			// Compaction keeps the conversation ID — the old full history is forked
			// to an archive (newConversationId). Just reload the same conversation's
			// history (dispose stale store + cache + re-fetch).
			const cid = msg.conversationId;
			const wasActive = tabsStore.activeConversationId === cid;
			const store = chatStores.get(cid);
			if (store !== undefined) {
				store.dispose();
			}
			void cache.delete(cid);
			const fresh = createChatFor(cid, activeModel, activeWorkspaceId);
			chatStores.set(cid, fresh);
			void fresh.load();
			if (wasActive) {
				refreshActiveChat();
			}
		},
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
			// Re-attach to every MODAL watch too (a run-chat modal open across a
			// reconnect keeps streaming). Watch stores are separate from tabs.
			for (const [watchId, watchStore] of watchStores) {
				subscribeChat(watchId);
				watchStore.resync();
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
			modelInfo = data.modelInfo ?? {};
			if (data.models.length > 0 && !data.models.includes(activeModel)) {
				const first = data.models[0];
				if (first !== undefined) {
					activeModel = first;
					draftStore.setModel(first);
				}
			}
		})
		.catch((err) => {
			reportError("Failed to load model list", err);
		});

	// Fetch the discovered-computer catalog (global, like models). Empty until
	// the `ssh` extension lands — a safe no-op until then (the selector shows
	// "Local (none)" only). Non-fatal: a failure leaves an empty list.
	void fetchImpl(`${httpBase}/computers`)
		.then((res) => {
			if (!res.ok) return { computers: [] } as ComputerListResponse;
			return res.json() as Promise<ComputerListResponse>;
		})
		.then((data) => {
			computers = data?.computers ?? [];
		})
		.catch((err) => {
			reportError("Failed to load computer list", err);
		});

	// Restore persisted tabs
	const persistedState = storageAdapter.load();
	if (persistedState !== null && persistedState.tabs.length > 0) {
		for (const tab of persistedState.tabs) {
			const store = createChatFor(tab.conversationId, tab.model, tab.workspaceId);
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
	void refreshComputer();
	void refreshModel();
	void refreshReasoningEffort();
	void refreshCompactPercent();

	// Fetch the authoritative open-conversation list from the backend (cross-
	// device tab sync). Merges with the localStorage-restored tabs: opens new
	// ones, removes closed ones, updates titles + statuses.
	void fetchOpenConversations();

	return {
		get tabs(): readonly Tab[] {
			return tabsStore.tabs.filter((t) => t.workspaceId === activeWorkspaceId);
		},
		get activeConversationId(): string | null {
			return tabsStore.activeConversationId;
		},
		get activeWorkspaceId(): string {
			return activeWorkspaceId;
		},
		setActiveWorkspace(workspaceId: string): void {
			activeWorkspaceId = workspaceId;
			// Reset to a fresh draft scoped to the new workspace so a new chat is
			// stamped with the right `workspaceId` on `chat.send`.
			const nextDraftId = randomId();
			draftStore = createChatFor(nextDraftId, activeModel, workspaceId);
			draftConversationId = nextDraftId;
			tabsStore.newDraft();
			refreshActiveChat();
			syncSubscriptions();
			void refreshCwd();
			void refreshComputer();
			void refreshModel();
			void refreshReasoningEffort();
			void refreshCompactPercent();
		},
		get activeChat(): ChatStore {
			return activeChat;
		},
		get models(): readonly string[] {
			return models;
		},
		get modelInfo(): Readonly<Record<string, ModelMetadata>> {
			return modelInfo;
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
		get storage() {
			return localStorageOpt;
		},
		get cwd(): string | null {
			return cwd;
		},
		get computerId(): string | null {
			return computerId;
		},
		get computers(): readonly ComputerEntry[] {
			return computers;
		},
		get reasoningEffort(): ReasoningEffort | null {
			return reasoningEffort;
		},
		get compactPercent(): number | null {
			return compactPercent;
		},
		get chatLimit(): number {
			return chatLimit;
		},
		conversationStatus(conversationId: string): ConversationStatus | undefined {
			return conversationStatuses.get(conversationId);
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
					workspaceId: activeWorkspaceId,
				});
				chatStores.set(conversationId, draftStore);
				void draftStore.load();

				// Prepare next draft
				const nextDraftId = randomId();
				draftStore = createChatFor(nextDraftId, activeModel, activeWorkspaceId);
				draftConversationId = nextDraftId;

				refreshActiveChat();
				// The draft became a real conversation: re-scope conversation-scoped
				// surfaces (e.g. cache-warming) to its id.
				syncSubscriptions();
				void refreshCwd();
				void refreshComputer();
				void refreshReasoningEffort();
				void refreshCompactPercent();
				// Now send on the promoted store
				chatStores.get(conversationId)?.send(text);
			} else {
				activeChat.send(text);
			}
		},

		queueMessage(text: string): void {
			// Only offered while generating (Composer switches to `chat.queue`
			// when `status === "running"`), so a draft (never generating) never
			// reaches here. `chat.queue` auto-starts a turn if idle, so even a race
			// (turn sealed between the status read and the send) is safe — the
			// server starts a fresh turn with the message as its opening prompt.
			activeChat.queueMessage(text);
		},

		selectModel(model: string): void {
			activeModel = model;
			const activeId = tabsStore.activeConversationId;
			if (activeId !== null) {
				tabsStore.setModel(activeId, model);
				chatStores.get(activeId)?.setModel(model);
				void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(activeId)}/model`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model } satisfies SetModelRequest),
				}).catch((err) => {
					reportError("Failed to persist model", err);
				});
			} else {
				draftStore.setModel(model);
			}
		},

		newDraft(): void {
			tabsStore.newDraft();
			const nextDraftId = randomId();
			draftStore = createChatFor(nextDraftId, activeModel, activeWorkspaceId);
			draftConversationId = nextDraftId;
			refreshActiveChat();
			syncSubscriptions();
			void refreshCwd();
			void refreshComputer();
			void refreshModel();
			void refreshReasoningEffort();
			void refreshCompactPercent();
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
			void refreshComputer();
			void refreshModel();
			void refreshReasoningEffort();
			void refreshCompactPercent();
		},

		closeTab(conversationId: string): void {
			// The user is DONE with this chat: abort any in-flight turn + stop/disable
			// its cache-warming, server-side (POST /close sets status → "closed").
			closeConversation(conversationId);
			removeTabLocally(conversationId);
		},

		renameTab(conversationId: string, title: string): void {
			tabsStore.setTitle(conversationId, title);
			void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(conversationId)}/title`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title } satisfies SetTitleRequest),
			}).catch((err) => {
				reportError("Failed to rename conversation", err);
			});
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
			const body: SetCwdRequest = {
				cwd: value,
				workspaceId: untrack(() => activeWorkspaceId),
			};
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

		async setComputer(computerIdValue: string | null): Promise<ComputerResult | null> {
			const id = workspaceConversationId();
			const body: SetConversationComputerRequest = { computerId: computerIdValue };
			try {
				const res = await fetchImpl(
					`${httpBase}/conversations/${encodeURIComponent(id)}/computer`,
					{
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Set computer failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as ConversationComputerResponse;
				const next = data.computerId ?? null;
				if (workspaceConversationId() === id) computerId = next;
				return { ok: true, computerId: next };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Set computer request failed",
				};
			}
		},

		async computerStatus(alias: string): Promise<ComputerStatusResult | null> {
			if (alias === "") return null;
			try {
				const res = await fetchImpl(`${httpBase}/computers/${encodeURIComponent(alias)}/status`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Computer status failed (HTTP ${res.status})`,
					};
				}
				const status = (await res.json()) as ComputerStatusResponse;
				return { ok: true, response: status };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Computer status request failed",
				};
			}
		},

		async testComputer(alias: string): Promise<TestComputerResult | null> {
			if (alias === "") return null;
			try {
				const res = await fetchImpl(`${httpBase}/computers/${encodeURIComponent(alias)}/test`, {
					method: "POST",
				});
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Test computer failed (HTTP ${res.status})`,
					};
				}
				const response = (await res.json()) as TestComputerResponse;
				return { ok: true, response };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Test computer request failed",
				};
			}
		},

		async setReasoningEffort(level: ReasoningEffort): Promise<ReasoningEffortResult | null> {
			const id = workspaceConversationId();
			const body: SetReasoningEffortRequest = { reasoningEffort: level };
			try {
				const res = await fetchImpl(
					`${httpBase}/conversations/${encodeURIComponent(id)}/reasoning-effort`,
					{
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Set reasoning effort failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as ReasoningEffortResponse;
				const next = data.reasoningEffort ?? level;
				if (workspaceConversationId() === id) reasoningEffort = next;
				return { ok: true, reasoningEffort: next };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Set reasoning effort request failed",
				};
			}
		},

		stopGeneration(): void {
			const conversationId = tabsStore.activeConversationId;
			if (conversationId === null) return;
			void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(conversationId)}/stop`, {
				method: "POST",
			}).catch((err) => {
				reportError("Failed to stop generation", err);
			});
		},

		async compactNow(keepLastN?: number): Promise<CompactResult | null> {
			const conversationId = tabsStore.activeConversationId;
			if (conversationId === null) return null;
			const body: Record<string, unknown> = {};
			if (keepLastN !== undefined) body.keepLastN = keepLastN;
			try {
				const res = await fetchImpl(
					`${httpBase}/conversations/${encodeURIComponent(conversationId)}/compact`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Compact failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as CompactResponse;
				return { ok: true, response: data };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Compact request failed",
				};
			}
		},

		async setCompactPercent(percent: number): Promise<CompactPercentResult | null> {
			const id = workspaceConversationId();
			const body: SetCompactPercentRequest = { threshold: percent };
			try {
				const res = await fetchImpl(
					`${httpBase}/conversations/${encodeURIComponent(id)}/compact-percent`,
					{
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Set compact percent failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as CompactPercentResponse;
				if (workspaceConversationId() === id) compactPercent = data.threshold;
				return { ok: true, percent: data.threshold };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Set compact percent request failed",
				};
			}
		},

		async setChatLimit(limit: number): Promise<ChatLimitResult> {
			const next = normalizeChatLimit(limit);
			chatLimitStore.save(next);
			chatLimit = next;
			// Propagate to every live chat store. The ACTIVE one is awaited so its
			// refill (on a raise) lands before the caller returns — letting the
			// shell preserve scroll over the prepended older chunks. Background
			// stores refill fire-and-forget. Future stores pick the new limit up at
			// creation (via the persisted store).
			const active = getActiveChat();
			await active.setChatLimit(next);
			for (const s of chatStores.values()) {
				if (s !== active) void s.setChatLimit(next);
			}
			if (draftStore !== active) void draftStore.setChatLimit(next);
			return { ok: true, chatLimit: next };
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

		async mcpStatus(): Promise<McpResult | null> {
			const id = workspaceConversationId();
			try {
				const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/mcp`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return { ok: false, error: errBody?.error ?? `MCP status failed (HTTP ${res.status})` };
				}
				// Normalize the untyped body at this network seam so a malformed/partial
				// response can never crash the renderer (servers is guaranteed an array).
				const data = (await res.json()) as Partial<McpStatusResponse>;
				const response: McpStatusResponse = {
					conversationId: data.conversationId ?? id,
					cwd: data.cwd ?? null,
					servers: Array.isArray(data.servers) ? data.servers : [],
				};
				return { ok: true, response };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "MCP status request failed",
				};
			}
		},

		async heartbeatConfig(): Promise<HeartbeatConfigResult> {
			// Workspace-scoped (NOT per-conversation): use the active workspace id.
			const wsId = untrack(() => activeWorkspaceId);
			try {
				const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Heartbeat config failed (HTTP ${res.status})`,
					};
				}
				// Normalize the untyped JSON at the network seam (pure helper) so a
				// malformed/partial response can never crash the renderer.
				const config: HeartbeatConfig = normalizeHeartbeatConfig(await res.json());
				return { ok: true, config };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Heartbeat config request failed",
				};
			}
		},

		async setHeartbeatConfig(patch: HeartbeatConfigPatch): Promise<HeartbeatConfigResult> {
			const wsId = untrack(() => activeWorkspaceId);
			try {
				const res = await fetchImpl(
					`${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat`,
					{
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch),
					},
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Set heartbeat config failed (HTTP ${res.status})`,
					};
				}
				const config: HeartbeatConfig = normalizeHeartbeatConfig(await res.json());
				return { ok: true, config };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Set heartbeat config request failed",
				};
			}
		},

		async heartbeatRuns(): Promise<HeartbeatRunsResult> {
			const wsId = untrack(() => activeWorkspaceId);
			try {
				const res = await fetchImpl(
					`${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat/runs`,
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Heartbeat runs failed (HTTP ${res.status})`,
					};
				}
				const runs: readonly HeartbeatRun[] = normalizeHeartbeatRuns(await res.json());
				return { ok: true, runs };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Heartbeat runs request failed",
				};
			}
		},

		async stopHeartbeatRun(runId: string): Promise<HeartbeatStopResult> {
			const wsId = untrack(() => activeWorkspaceId);
			try {
				const res = await fetchImpl(
					`${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat/runs/${encodeURIComponent(runId)}/stop`,
					{ method: "POST" },
				);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Stop heartbeat run failed (HTTP ${res.status})`,
					};
				}
				return { ok: true };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Stop heartbeat run request failed",
				};
			}
		},

		async heartbeatNextRun(): Promise<HeartbeatNextRunResult> {
			const wsId = untrack(() => activeWorkspaceId);
			try {
				const res = await fetchImpl(
					`${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat/next-run`,
				);
				if (!res.ok) {
					// 404 = the backend hasn't shipped CR-HB-3 yet → the FE falls back to
					// an approximation. Surface as ok:false (non-fatal).
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Heartbeat next-run failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json().catch(() => null)) as { nextRunAt?: string | null } | null;
				// `null` (disabled / no run scheduled) passes through; anything non-string
				// also becomes null so a malformed body can't crash the countdown.
				const raw = data?.nextRunAt;
				const nextRunAt = typeof raw === "string" ? raw : null;
				return { ok: true, nextRunAt };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Heartbeat next-run request failed",
				};
			}
		},

		watchConversation(conversationId: string): ChatStore {
			return watchConversation(conversationId);
		},

		unwatchConversation(conversationId: string): void {
			unwatchConversation(conversationId);
		},

		async loadSystemPrompt(): Promise<SystemPromptLoadResult> {
			try {
				const res = await fetchImpl(`${httpBase}/system-prompt`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Load system prompt failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as SystemPromptTemplateResponse;
				return { ok: true, template: data.template ?? "" };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Load system prompt request failed",
				};
			}
		},

		async setSystemPrompt(template: string): Promise<SystemPromptSaveResult> {
			try {
				const body: SetSystemPromptTemplateRequest = { template };
				const res = await fetchImpl(`${httpBase}/system-prompt`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Set system prompt failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as SystemPromptTemplateResponse;
				return { ok: true, template: data.template };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Set system prompt request failed",
				};
			}
		},

		async loadSystemPromptVariables(): Promise<SystemPromptVariablesResult> {
			try {
				const res = await fetchImpl(`${httpBase}/system-prompt/variables`);
				if (!res.ok) {
					const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
					return {
						ok: false,
						error: errBody?.error ?? `Load system prompt variables failed (HTTP ${res.status})`,
					};
				}
				const data = (await res.json()) as Partial<SystemPromptVariablesResponse>;
				return { ok: true, variables: Array.isArray(data.variables) ? data.variables : [] };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : "Load system prompt variables request failed",
				};
			}
		},

		attachUnloadGate(gate: () => boolean): void {
			unloadGate = gate;
		},

		get fatalError(): string | null {
			return fatalError;
		},
		clearFatalError(): void {
			fatalError = null;
		},

		dispose(): void {
			for (const store of chatStores.values()) {
				store.dispose();
			}
			chatStores.clear();
			for (const store of watchStores.values()) {
				store.dispose();
			}
			watchStores.clear();
			draftStore.dispose();
			socket?.close();
			socket = null;
		},
	};
}
