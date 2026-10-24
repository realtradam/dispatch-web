import type {
  CompactResponse,
  ComputerStatusResponse,
  LspStatusResponse,
  McpStatusResponse,
  ModelMetadata,
  ReasoningEffort,
  SystemPromptVariable,
  TestComputerResponse,
  WarmResponse,
} from "@dispatch/transport-contract";
import type { SurfaceSpec } from "@dispatch/ui-contract";
import type { ComputerEntry, ConversationStatus, ImageInput } from "@dispatch/wire";
import type { WebSocketLike } from "../adapters/ws";
import type { ProtocolState } from "../core/protocol";
import type {
  AccountUsageProviderId,
  AccountUsageResult,
  AccountUsageSettingsResult,
  UpdateAccountUsageSettingsRequest,
} from "../features/account-usage";
import type { ChatStore } from "../features/chat";
import type {
  ConcurrencyCooldownResult,
  ConcurrencyDeleteResult,
  ConcurrencyLimitResult,
  ConcurrencyLimitsResult,
  ConcurrencyStatusResult,
} from "../features/concurrency";
import type {
  HeartbeatConfigPatch,
  HeartbeatConfigResult,
  HeartbeatNextRunResult,
  HeartbeatRunsResult,
  HeartbeatStopResult,
} from "../features/heartbeat";
import type { LayoutStore } from "../features/layout";
import type { TextFileClient } from "../features/markdown";
import type {
  NamedAgent,
  NamedAgentDeleteResult,
  NamedAgentInput,
  NamedAgentSaveResult,
  NamedAgentSelectionSnapshot,
  NamedAgentsResult,
} from "../features/named-agents";
import type { PluginsStore } from "../features/plugins";
import type { SearchBackendConfigResult } from "../features/search-settings";
import type { Tab } from "../features/tabs";
import type { VisionSettings, VisionSettingsPatch } from "../features/vision";
import type { TileLayoutStore } from "../features/workspaces";

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

/**
 * Outcome of `PUT /conversations/:id/thinking` (PROPOSED — see
 * `backend-handoff.md`; the endpoint is not yet shipped by the backend).
 */
export type ThinkingResult =
  | { readonly ok: true; readonly thinking: boolean }
  | { readonly ok: false; readonly error: string };

/** Outcome of `POST /conversations/:id/compact` (manual compaction). */
export type CompactResult =
  | { readonly ok: true; readonly response: CompactResponse }
  | { readonly ok: false; readonly error: string };

/** Outcome of `PUT /conversations/:id/compact-percent`. */
export type CompactPercentResult =
  | { readonly ok: true; readonly percent: number }
  | { readonly ok: false; readonly error: string };

/** Outcome of `PUT /settings/vision` (global vision-settings save). */
export type VisionSettingsResult =
  | { readonly ok: true; readonly settings: VisionSettings }
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
  /**
   * The resolved HTTP API base URL (e.g. `http://localhost:24203`). Used to
   * resolve relative image URLs served by the backend (`/images/…`) into
   * absolute URLs for `<img src>`.
   */
  readonly httpBase: string;
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
  /**
   * The current spec by id, or null if absent. With conversationId, require a
   * snapshot received for that conversation (not a retained prior-scope spec).
   */
  surface(surfaceId: string, conversationId?: string): SurfaceSpec | null;
  /**
   * Send a user message (start a turn). Forwards any staged `images`
   * (`ImageInput[]` — base64 data URLs / https URLs) on the `chat.send` op;
   * the server passes them to a vision-capable model natively or transcribes
   * them via vision handoff for a non-vision model. Omitted on the wire when
   * none are staged. On a draft, promotes to a tab first.
   */
  send(text: string, images?: readonly ImageInput[]): void;
  /**
   * Enqueue a steering message onto the focused conversation's queue
   * (`chat.queue` WS op). While a turn is generating, the message is delivered
   * mid-turn at the next tool-result boundary; when idle, the server
   * auto-starts a turn (equivalent to `send`). Safe to offer whenever the user
   * wants to add input — the server owns the idle-vs-generating decision.
   */
  queueMessage(text: string, images?: readonly ImageInput[]): void;
  /**
   * Cancel (remove) a single queued steering message by id so it never runs
   * (`chat.queue.cancel` WS op). Fire-and-forget + idempotent: the
   * message-queue surface update reconciles the queue UI (the cancelled message
   * leaves the snapshot). Targets the focused conversation's queue. The caller
   * optimistically hides the row; a cancel of an already-drained / unknown
   * message is a silent server no-op (nothing to roll back).
   */
  cancelQueuedMessage(messageId: string): void;
  /** Select a raw model for the active conversation. Pass `snapshot` to record a Named Agent selection (plan §7). */
  selectModel(model: string, snapshot?: NamedAgentSelectionSnapshot): void;
  newDraft(): void;
  /** Switch the active workspace (on route change) + reset to a fresh draft in it. */
  setActiveWorkspace(workspaceId: string): void;
  selectTab(conversationId: string): void;
  closeTab(conversationId: string): void;
  renameTab(conversationId: string, title: string): void;
  /**
   * Move a tab into a subagent group (the tab group parent's id) or out of
   * any group (null). Purely presentational (NOT lineage): applied
   * optimistically, persisted via `PUT /conversations/:id/tab-group` (synced
   * to other clients by `conversation.tabGroupChanged`), reverted on failure.
   */
  setTabGroup(conversationId: string, parentId: string | null): void;
  invoke(surfaceId: string, actionId: string, payload?: unknown): void;
  /**
   * Explicitly (re-)subscribe one surface, scoped to `conversationId` (or the
   * focused conversation when absent) — the frontend-plugin ABI's
   * `surfaces.subscribe` path (plan 03). The app auto-subscribes every
   * catalog entry; this is the re-assertion port (same wire semantics).
   */
  subscribeSurface(surfaceId: string, conversationId?: string): void;
  /** Drop one surface's subscription (the ABI's `surfaces.unsubscribe`). */
  unsubscribeSurface(surfaceId: string, conversationId?: string): void;
  /**
   * Manually warm the focused conversation's prompt cache (`POST /chat/warm`).
   * Returns null when no conversation is focused (a draft has nothing to warm).
   */
  warmNow(): Promise<WarmResult | null>;
  /** The workspace conversation's persisted working directory, or null when unset. */
  readonly cwd: string | null;
  /** Invalidates live-file routing after known settings changes. */
  readonly textFileContextRevision: number;
  createTextFileClient(conversationId: string): TextFileClient;
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
   * The workspace conversation's persisted thinking flag, or null when never
   * set (the server then resolves turns with thinking ON — the default).
   * `false` ⇒ thinking disabled entirely (the SEPARATE "off" axis — NOT a
   * zero-effort level; the umans route maps it to `reasoning_effort: "none"`).
   * PROPOSED backend contract — see `backend-handoff.md`.
   */
  readonly thinking: boolean | null;
  /**
   * Persist the workspace conversation's thinking flag
   * (`PUT /conversations/:id/thinking`). Works for a draft too (its id survives
   * promotion), so the first turn already runs with the chosen setting. Takes
   * effect from the NEXT turn; resolution stays server-owned.
   * PROPOSED backend contract — see `backend-handoff.md`.
   */
  setThinking(enabled: boolean): Promise<ThinkingResult | null>;
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
   * The GLOBAL vision settings (`GET /settings/vision`): `imageLimit` (max
   * native images per turn before compaction; 0 = disabled) + `compactionModel`
   * (which vision model transcribes old images; null = auto). Shared across all
   * conversations. Seeded on boot; `null` = not yet fetched.
   */
  readonly visionSettings: VisionSettings | null;
  /**
   * Refetch the global vision settings (`GET /settings/vision`). Called by the
   * vision-settings view on mount; also seeded on boot.
   */
  refreshVisionSettings(): Promise<void>;
  /**
   * Save a PARTIAL vision-settings update (`PUT /settings/vision`). Either
   * field may be omitted. Returns the merged settings on success.
   */
  setVisionSettings(patch: VisionSettingsPatch): Promise<VisionSettingsResult | null>;
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
   * Whether at least one conversation in the given workspace is currently
   * active or queued (generating / waiting for a concurrency slot) — drives
   * the loading-dots indicator on workspace cards. Backed by a once-derived
   * `activeWorkspaces` set (the open-tab set × the backend lifecycle statuses)
   * so this is an O(1) lookup, not a per-card scan of the full tab list.
   * Reactive: the set is a `$derived`, so a Svelte template expression calling
   * this re-runs when the tab set or status map changes.
   */
  workspaceHasActiveConversations(workspaceId: string): boolean;
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
   * Load all configured per-provider concurrency limits
   * (`GET /concurrency/limits`). Global (not workspace-scoped). Returns an empty
   * list when the concurrency extension isn't loaded (`{ limits: [] }`).
   */
  concurrencyLimits(): Promise<ConcurrencyLimitsResult>;
  /**
   * Fetch the configured limit for one provider
   * (`GET /concurrency/limits/:providerId`). `404` (no limit configured) and
   * `503` (extension not loaded) both surface as `ok: false`.
   */
  getConcurrencyLimit(providerId: string): Promise<ConcurrencyLimitResult>;
  /**
   * Set or update a provider's concurrency limit
   * (`PUT /concurrency/limits/:providerId`, body `{ limit }`). `limit` must be a
   * positive integer (a non-positive body is `400`). At the cap, further requests
   * queue oldest-agent-first rather than being sent immediately.
   */
  setConcurrencyLimit(providerId: string, limit: number): Promise<ConcurrencyLimitResult>;
  /**
   * Remove a provider's concurrency limit (`DELETE /concurrency/limits/:providerId`),
   * making it unlimited. `404` (not configured) and `503` (extension not loaded)
   * both surface as `ok: false`.
   */
  deleteConcurrencyLimit(providerId: string): Promise<ConcurrencyDeleteResult>;
  /**
   * Fetch live concurrency status for every provider with a configured limit
   * (`GET /concurrency/status`): in-flight slots held, agents queued, and a paused
   * state with a `pausedUntil` epoch-ms when a 429 backoff is in effect. Each
   * entry also carries the per-slot release `cooldownMs` + an `autoReduced` flag
   * (true when a 429 auto-reduced the limit by 1; the FE renders a banner). Returns
   * an empty list when the extension isn't loaded (`{ providers: [] }`).
   */
  concurrencyStatus(): Promise<ConcurrencyStatusResult>;
  /**
   * Load Claude + Codex subscription usage (`GET /usage`). Served from the
   * backend's cache (5 min TTL); `refresh: true` sends `?refresh=1`, which the
   * server still rate-limits (min interval + failure cooldown). A 503 (the
   * `account-usage` extension isn't loaded) returns `unavailable: true`.
   */
  accountUsage(opts?: { readonly refresh?: boolean }): Promise<AccountUsageResult>;
  /**
   * Update a provider's usage settings (`PUT /usage/:provider/settings`; today
   * only `hyper`: `dailyAllowance` + `resetAnchor` epoch-ms or null). Returns
   * the provider's refreshed report.
   */
  setAccountUsageSettings(
    provider: AccountUsageProviderId,
    settings: UpdateAccountUsageSettingsRequest,
  ): Promise<AccountUsageSettingsResult>;
  /**
   * Load the GLOBAL search-backend selection
   * (`GET /search/config`): which engine backs the `web_search` tool's search
   * mode. Not workspace-scoped — the selection is global. `unavailable: true`
   * on the failure variant marks the 503 degrade (the backend's
   * search-config service not loaded) so the UI can disable the field.
   */
  searchBackendConfig(): Promise<SearchBackendConfigResult>;
  /**
   * Persist a new search-backend selection
   * (`PUT /search/config`, body `{ backend }`). `400` (unknown/unconfigured
   * backend) and `503` (service not loaded) both surface as `ok: false`.
   */
  setSearchBackend(backend: string): Promise<SearchBackendConfigResult>;
  /**
   * Fetch the per-slot release cooldown (ms) for one provider
   * (`GET /concurrency/cooldown/:providerId`). `404` (no concurrency config at
   * all) and `503` (extension not loaded) both surface as `ok: false`.
   */
  getConcurrencyCooldown(providerId: string): Promise<ConcurrencyCooldownResult>;
  /**
   * Set the per-slot release cooldown (ms) for one provider
   * (`PUT /concurrency/cooldown/:providerId`, body `{ cooldownMs }`). `cooldownMs`
   * must be a non-negative integer (0 = no cooldown / instant re-admission); an
   * invalid body is `400`. Persists + applies to subsequently recycled slots.
   */
  setConcurrencyCooldown(
    providerId: string,
    cooldownMs: number,
  ): Promise<ConcurrencyCooldownResult>;
  /**
   * A critical error that blocks normal operation (e.g. the cross-device tab
   * restore fetch failed). When non-null, a full-screen modal is shown with the
   * error details. Cleared by `clearFatalError` (the modal's dismiss button).
   */
  readonly fatalError: string | null;
  /** Dismiss the fatal error (called by the error modal's X button). */
  clearFatalError(): void;
  // ── Named Agents (global config; plan §9) ──────────────────────────────────
  /**
   * The persisted Named Agents (from `GET /named-agents`). Global user config
   * (not per-workspace); seeded on boot. Drives the sidebar editor AND the
   * synthetic "Named Agents" provider in the model selector (plan §6).
   */
  readonly namedAgents: readonly NamedAgent[];
  /**
   * The active conversation's Named Agent selection snapshot (plan §7), or null
   * when it was selected via a raw model. Survives the Named Agent being renamed
   * / removed (the snapshot retains the friendly label + captured raw model).
   */
  readonly namedAgentSnapshot: NamedAgentSelectionSnapshot | null;
  /** Refetch the Named Agents (`GET /named-agents`). */
  refreshNamedAgents(): Promise<NamedAgentsResult>;
  // ── Plugins (plan 07) ──────────────────────────────────────────────────────
  /**
   * The plugin manager + per-workspace enablement store (one instance per
   * app store). The workspaces page's manager/modal read + mutate through
   * it; the app store feeds its `onExtensionsChanged` hook.
   */
  readonly plugins: PluginsStore;
  /**
   * The ACTIVE workspace's tile tree (plan 02): served by the backend's
   * layout provider when one is active, the local default otherwise. The
   * shell reads `tree` for the renderer and feeds edits back through
   * `onTreeChange` (debounced PUT + rollback); the store owns the probes,
   * the WS-push filter, and the no-provider degrade.
   */
  readonly layout: LayoutStore;
  /**
   * The home grid's synced tile layout (ONE shared document per device
   * orientation — `wide` = landscape/desktop, `tall` = portrait/mobile),
   * served by the backend's home-tile-layout plugin. The home page locks the
   * active orientation to the resolved grid geometry; this store owns the
   * probes, the WS-push filter, the debounced PUT + rollback, and the
   * offline degrade.
   */
  readonly tileLayout: TileLayoutStore;
  /**
   * Loaded provider-tier plugins effectively enabled in the ACTIVE workspace
   * (`GET /workspaces/:id/plugins/providers-status`). `null` = unknown — the
   * first-boot guardrail renders only on a confident `0` (§7).
   */
  readonly enabledProviderCount: number | null;
  /**
   * Create a Named Agent (`POST /named-agents`). On success the store's
   * `namedAgents` list is updated (append/replace) so every consumer — the
   * sidebar editor AND the model selector — reflects it without a reload.
   */
  createNamedAgent(input: NamedAgentInput): Promise<NamedAgentSaveResult>;
  /**
   * Update a Named Agent (`PUT /named-agents/:id`). On success the store list is
   * updated in place. Returns the canonical saved record.
   */
  updateNamedAgent(id: string, input: NamedAgentInput): Promise<NamedAgentSaveResult>;
  /**
   * Remove a Named Agent (`DELETE /named-agents/:id`). On success it leaves the
   * store list immediately (removing it from the sidebar + model selector), and
   * does NOT alter conversations that previously selected it (those keep their
   * snapshot — plan §7).
   */
  deleteNamedAgent(id: string): Promise<NamedAgentDeleteResult>;
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
  /**
   * How live chat events are batched before folding into a chat store.
   * Default: once per animation frame (with a timeout fallback for hidden
   * tabs). `null` = fold every event synchronously (tests that assert on the
   * transcript immediately after feeding a frame).
   */
  chatFlushScheduler?: ((flush: () => void) => void) | null;
}
