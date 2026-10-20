import type {
  ModelMetadata,
  ModelResponse,
  ReasoningEffort,
  SetModelRequest,
  WorkspaceSetMessage,
} from "@dispatch/transport-contract";
import type { SurfaceSpec } from "@dispatch/ui-contract";
import type { ComputerEntry, ConversationStatus, ImageInput } from "@dispatch/wire";
import { createIdbChunkStore } from "../adapters/idb";
import { createLocalStore } from "../adapters/local-storage";
import { createSurfaceSocket } from "../adapters/ws";
import { getSurfaceSpec } from "../core/protocol";
import type { ChatStore } from "../features/chat";
import { migrateLegacyModelName } from "../features/chat";
import { createConversationCache } from "../features/conversation-cache";
import type { LayoutStore } from "../features/layout";
import {
  createLayoutAbiPort,
  createLayoutHttp,
  createLayoutStore,
  listPanelViews,
} from "../features/layout";
import type { NamedAgent, NamedAgentSelectionSnapshot } from "../features/named-agents";
import type { PluginsStore } from "../features/plugins";
import { createPluginsHttp, createPluginsStore } from "../features/plugins";
import type { Tab, TabsState } from "../features/tabs";
import { createTabsStore, deriveTitle, type TabsStore } from "../features/tabs";
import type { VisionSettings } from "../features/vision";
import {
  createTileLayoutHttp,
  createTileLayoutStore,
  geometryFor,
  type TileLayoutStore,
} from "../features/workspaces";
import { createChatRegistry } from "./chat-registry.svelte";
import { createConversationSettings } from "./conversation-settings.svelte";
import { createHistorySync, createMetricsSync } from "./history-sync";
import { createHttpActions } from "./http-actions";
import { createOpenConversations } from "./open-conversations.svelte";
import { createPluginHost } from "./plugin-host.svelte";
import { resolveHttpUrl } from "./resolve-http-url";
import { resolveWsUrl } from "./resolve-ws-url";
import { createSettingsRefreshers } from "./settings-refreshers.svelte";
import type { AppStore, CreateAppStoreOptions } from "./store-types";
import { createSurfaceProtocol } from "./surface-protocol.svelte";
import { randomId } from "./uuid";
import { createWsHandlers } from "./ws-handlers";

const DEFAULT_MODEL = "opencode-1/deepseek-v4-flash";

export type {
  AppStore,
  ChatLimitResult,
  CompactPercentResult,
  CompactResult,
  ComputerResult,
  ComputerStatusResult,
  CreateAppStoreOptions,
  CwdResult,
  LspResult,
  McpResult,
  ReasoningEffortResult,
  SystemPromptLoadResult,
  SystemPromptSaveResult,
  SystemPromptVariablesResult,
  TestComputerResult,
  ThinkingResult,
  VisionSettingsResult,
  WarmResult,
} from "./store-types";

export function createAppStore(opts?: CreateAppStoreOptions): AppStore {
  let activeModel = $state(DEFAULT_MODEL);
  // The active conversation's Named Agent snapshot (null when selected via a raw
  // model). Derived from the active tab; survives a Named Agent being edited.
  let namedAgentSnapshot = $state<NamedAgentSelectionSnapshot | null>(null);
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

  // ── Plugins (plan 07) ──────────────────────────────────────────────────────
  // The plugin-manager + per-workspace enablement state lives in its own
  // feature store (one instance per app store, passed explicitly to the UI).
  // The app store wires the server's `extensions-changed` broadcast into it
  // (§11 multi-client coherence) and refreshes the workspace-scoped model
  // picker + guardrail on the same event.
  const pluginsHttp = createPluginsHttp(httpBase, fetchImpl);
  const pluginsStore = createPluginsStore(pluginsHttp);

  // ── Layout (plan 02) ─────────────────────────────────────────────────────────
  // The ACTIVE workspace's tile tree, owned by the backend's layout provider
  // plugin when one is active (its well-known routes + the `layout` WS push)
  // and rendered from the local default otherwise (no-provider mode: edits
  // ephemeral, logged once, no error UI). Probes run on boot, on every
  // workspace switch, and on `extensions-changed` (§2.6); the one-way
  // localStorage migration (§2.7) arms on the boot probe.
  const layoutHttp = createLayoutHttp(httpBase, fetchImpl);
  const layoutStore = createLayoutStore({
    http: layoutHttp,
    workspaceId: activeWorkspaceId,
    storage: localStorageOpt,
    knownViews: listPanelViews().map((v) => v.id),
  });

  // ── Home tile-layout (the synced Win8-Start grid) ─────────────────────────
  // ONE shared document PER device orientation (`wide` = landscape/desktop,
  // `tall` = portrait/mobile), persisted by the backend's home-tile-layout
  // plugin and broadcast over WS (`tile-layout`). The home page locks the
  // active orientation to the resolved grid geometry and renders
  // `tileLayout.entries`; this store owns the probes, the WS-push filter,
  // the debounced PUT + rollback, and the offline degrade.
  const tileLayoutStore = createTileLayoutStore({
    http: createTileLayoutHttp(httpBase, fetchImpl),
    initialMode:
      typeof window === "undefined"
        ? "wide"
        : geometryFor(window.innerWidth, window.innerHeight).mode,
    storage: localStorageOpt,
  });

  const refreshers = createSettingsRefreshers({
    httpBase,
    fetchImpl,
    activeWorkspaceId: () => activeWorkspaceId,
    reportError,
  });

  const storageAdapter = createLocalStore<TabsState>("dispatch.tabs", {
    storage: localStorageOpt,
  });
  const tabsStore: TabsStore = createTabsStore(storageAdapter);

  const registry = createChatRegistry({
    storage: localStorageOpt,
    tabsStore,
    createCache: () =>
      createConversationCache(createIdbChunkStore({ indexedDB: indexedDBFactory })),
    historySync: createHistorySync(httpBase, fetchImpl),
    metricsSync: createMetricsSync(httpBase, fetchImpl),
    defaultModel: DEFAULT_MODEL,
    activeModel: () => activeModel,
    activeWorkspaceId: () => activeWorkspaceId,
    send: (msg) => socket?.send(msg),
    reportError,
    chatFlushScheduler: opts?.chatFlushScheduler,
  });

  const cache = registry.cache;

  const settings = createConversationSettings({
    httpBase,
    fetchImpl,
    workspaceConversationId,
    activeWorkspaceId: () => activeWorkspaceId,
    reportError,
  });
  /** Refetch the workspace conversation's persisted model (works for a draft too). */
  async function refreshModel(): Promise<void> {
    const id = workspaceConversationId();
    try {
      const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/model`);
      if (!res.ok) return;
      const data = (await res.json()) as ModelResponse;
      if (workspaceConversationId() !== id) return;
      // The backend is authoritative for the persisted snapshot: restore how the
      // conversation was selected (a Named Agent, or none). Falls back to the tab's
      // local snapshot when the response omits it (older backend).
      namedAgentSnapshot = data.namedAgent ?? namedAgentSnapshot;
      if (typeof data.model === "string" && data.model.length > 0) {
        activeModel = data.model;
        const activeId = tabsStore.activeConversationId;
        if (activeId !== null) {
          tabsStore.setModel(activeId, data.model);
          tabsStore.setSnapshot(activeId, namedAgentSnapshot);
          registry.chatStores.get(activeId)?.setModel(data.model);
          registry.chatStores.get(activeId)?.setNamedAgent(namedAgentSnapshot);
        } else {
          registry.draftStore.setModel(data.model);
          registry.draftStore.setNamedAgent(namedAgentSnapshot);
        }
      }
    } catch (err) {
      reportError("Failed to load model", err);
    }
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
    return tabsStore.activeConversationId ?? registry.draftConversationId;
  }

  const surfaces = createSurfaceProtocol({
    focusedConversationId,
    send: (msg) => socket?.send(msg),
  });

  let socket: ReturnType<typeof createSurfaceSocket> | null = null;

  const conversations = createOpenConversations({
    httpBase,
    fetchImpl,
    tabsStore,
    registry,
    cache,
    activeModel: () => activeModel,
    settings,
    syncSubscriptions: surfaces.syncSubscriptions,
    reportError,
  });
  const httpActions = createHttpActions({
    httpBase,
    fetchImpl,
    activeConversationId: () => tabsStore.activeConversationId,
    activeModel: () => activeModel,
    activeWorkspaceId: () => activeWorkspaceId,
    reportError,
  });

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

  // ── Frontend plugins (plan 03) ─────────────────────────────────────────────
  // The ABI driver's composition-root wiring: one host instance per app
  // store. `sync()` runs on boot, on `extensions-changed`, and on every
  // workspace switch (the three load-lifecycle triggers — the active
  // workspace is read per call, which makes workspace.set meaningful).
  // The surfaces ports delegate to the SAME protocol/socket machinery the
  // app store's own surface methods use (closure functions below, shared
  // with the returned object — no second protocol state).
  const pluginHost = createPluginHost({
    http: pluginsHttp,
    httpBase,
    reporter: pluginsStore,
    activeWorkspaceId: () => activeWorkspaceId,
    surfaces: {
      subscribe: (surfaceId, conversationId) =>
        surfaces.subscribeSurfaceOp(surfaceId, conversationId),
      unsubscribe: (surfaceId, conversationId) =>
        surfaces.unsubscribeSurfaceOp(surfaceId, conversationId),
      invoke: (surfaceId, actionId, payload, conversationId) =>
        surfaces.invokeSurfaceOp(surfaceId, actionId, payload, conversationId),
      getSpec: (surfaceId) => surfaces.surfaceSpecOp(surfaceId),
    },
    // plan 04 §4.5: the plugins' `api.layout` port — applyOps posts to the
    // ACTIVE workspace's provider (the ops route) and feeds the returned
    // tree back through the store (instant local echo; the WS broadcast is
    // every client's authoritative copy); getTree exposes the active tree
    // only while a provider is PRESENT (null = no-provider mode).
    layout: createLayoutAbiPort({
      store: layoutStore,
      postOps: (workspaceId, ops) => layoutHttp.postOps(workspaceId, ops),
    }),
  });

  const socketOpts = createWsHandlers({
    url: wsUrl,
    send: (msg) => socket?.send(msg),
    registry,
    conversations,
    surfaces,
    cache,
    tabsStore,
    activeWorkspaceId: () => activeWorkspaceId,
    workspaceSetMsg: (id) => workspaceSetMsg(id),
    pluginsStore,
    pluginHost,
    layoutStore,
    tileLayoutStore,
    refreshers,
    reportError,
  });
  if (opts?.socketFactory !== undefined) {
    socketOpts.socketFactory = opts.socketFactory;
  }
  socket = createSurfaceSocket(socketOpts);

  // Tell the backend THIS connection's active workspace (plan 06 §6.4). The
  // socket queues the send until the connection opens; on receipt the server
  // re-pushes the workspace-filtered surface catalog. Also refreshed on
  // reconnect (onReopen — a new connection is anonymous again).
  const workspaceSetMsg = (workspaceId: string): WorkspaceSetMessage => ({
    type: "workspace.set",
    workspaceId,
  });
  socket.send(workspaceSetMsg(activeWorkspaceId));

  // Fetch the model catalog (workspace-scoped — plan 06 §6.5).
  void refreshers.refreshModels();
  // Fetch the active workspace's provider status (§6.5 first-boot guardrail).
  void refreshers.refreshProviderStatus();
  // Probe the ACTIVE layout provider (plan 02 §2.6 boot trigger): the tree is
  // served by the backend's layout plugin when one is active. `boot: true`
  // arms the one-way §2.7 localStorage migration on the first success.
  void layoutStore.probe(activeWorkspaceId, { boot: true });
  // Frontend plugins (plan 03): the load lifecycle's boot trigger — every
  // loaded ∧ enabled ∧ frontend-declaring ∧ handshake-passing plugin is
  // imported + activated (after the first list fetch lands).
  void pluginHost.sync();
  // One-time legacy model-name migration on boot (independent of the fetch;
  // preserved from the pre-refreshModels boot chain).
  if (migrateLegacyModelName(activeModel) !== activeModel) {
    activeModel = migrateLegacyModelName(activeModel);
  }

  refreshers.loadGlobalCatalogs();

  // Restore persisted tabs
  const persistedState = storageAdapter.load();
  if (persistedState !== null && persistedState.tabs.length > 0) {
    for (const tab of persistedState.tabs) {
      // One-time persisted-state migration: rewrite a legacy `opencode/<model>`
      // tab model to the numbered `opencode-1/<model>` namespace, and persist the
      // migrated value back so a re-load is a no-op (idempotent).
      const model = migrateLegacyModelName(tab.model);
      if (model !== tab.model) {
        tabsStore.setModel(tab.conversationId, model);
      }
      const store = registry.createChatFor(tab.conversationId, model, tab.workspaceId);
      registry.chatStores.set(tab.conversationId, store);
      // Watch each restored conversation's live turns: after a reload mid-turn the
      // server replays the in-flight turn so we keep rendering it. Queued until the
      // socket opens.
      registry.subscribeChat(tab.conversationId);
    }
    if (persistedState.activeConversationId !== null) {
      const activeTab = persistedState.tabs.find(
        (t) => t.conversationId === persistedState.activeConversationId,
      );
      if (activeTab !== undefined) {
        activeModel = migrateLegacyModelName(activeTab.model);
        namedAgentSnapshot = activeTab.snapshot ?? null;
      }
    }
  }

  registry.refreshActiveChat();
  void settings.refreshCwd();
  void settings.refreshComputer();
  void refreshModel();
  void settings.refreshReasoningEffort();
  void settings.refreshThinking();
  void settings.refreshCompactPercent();
  void settings.refreshVisionSettings();

  // Fetch the authoritative open-conversation list from the backend (cross-
  // device tab sync). Merges with the localStorage-restored tabs: opens new
  // ones, removes closed ones, updates titles + statuses.
  void conversations.fetchOpenConversations();

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
    get httpBase(): string {
      return httpBase;
    },
    setActiveWorkspace(workspaceId: string): void {
      activeWorkspaceId = workspaceId;
      // Tell the backend the switch (plan 06 §6.4): workspace switching is
      // instant + client-side, so the server must be told explicitly — it
      // re-pushes the workspace-filtered surface catalog on receipt. The send
      // is idempotent + queued until the socket opens.
      socket?.send(workspaceSetMsg(workspaceId));
      // Reset to a fresh draft scoped to the new workspace so a new chat is
      // stamped with the right `workspaceId` on `chat.send`.
      const nextDraftId = randomId();
      registry.draftStore = registry.createChatFor(nextDraftId, activeModel, workspaceId);
      registry.draftConversationId = nextDraftId;
      tabsStore.newDraft();
      namedAgentSnapshot = null;
      registry.refreshActiveChat();
      surfaces.syncSubscriptions();
      void settings.refreshCwd();
      void settings.refreshComputer();
      void refreshModel();
      void settings.refreshReasoningEffort();
      void settings.refreshThinking();
      void settings.refreshCompactPercent();
      // The model picker + provider guardrail are WORKSPACE-SCOPED now
      // (plan 06 §6.5): refetch both for the new workspace.
      void refreshers.refreshModels();
      void refreshers.refreshProviderStatus();
      // The tile tree is WORKSPACE-SCOPED too (plan 02): reset to the local
      // default for the new workspace and probe its provider (§2.6 — every
      // workspace switch is a probe, which is also the missed-push catch-up).
      layoutStore.onWorkspaceChanged(workspaceId);
      // Frontend plugins (plan 03): the load lifecycle's workspace.set
      // trigger — the enablement set is WORKSPACE-SCOPED, so a switch may
      // load and unload frontend plugins.
      void pluginHost.sync();
    },
    get activeChat(): ChatStore {
      return registry.activeChat;
    },
    get models(): readonly string[] {
      return refreshers.models;
    },
    get modelInfo(): Readonly<Record<string, ModelMetadata>> {
      return refreshers.modelInfo;
    },
    get activeModel(): string {
      return activeModel;
    },
    get catalog() {
      return surfaces.protocol.catalog;
    },
    get surfaces(): readonly SurfaceSpec[] {
      const out: SurfaceSpec[] = [];
      for (const entry of surfaces.protocol.catalog) {
        const spec = getSurfaceSpec(surfaces.protocol, entry.id);
        if (spec) out.push(spec);
      }
      return out;
    },
    get lastError() {
      return surfaces.protocol.lastError;
    },
    get storage() {
      return localStorageOpt;
    },
    get cwd(): string | null {
      return settings.cwd;
    },
    get computerId(): string | null {
      return settings.computerId;
    },
    get computers(): readonly ComputerEntry[] {
      return refreshers.computers;
    },
    get reasoningEffort(): ReasoningEffort | null {
      return settings.reasoningEffort;
    },
    get thinking(): boolean | null {
      return settings.thinking;
    },
    get compactPercent(): number | null {
      return settings.compactPercent;
    },
    get visionSettings(): VisionSettings | null {
      return settings.visionSettings;
    },
    async refreshVisionSettings(): Promise<void> {
      await settings.refreshVisionSettings();
    },
    get chatLimit(): number {
      return registry.chatLimit;
    },
    conversationStatus(conversationId: string): ConversationStatus | undefined {
      return conversations.conversationStatuses.get(conversationId);
    },
    workspaceHasActiveConversations(workspaceId: string): boolean {
      // O(1) lookup into the once-derived `activeWorkspaces` set; false when the
      // workspace has no active/queued conversation (or none at all).
      return conversations.workspaceHasActiveConversations(workspaceId);
    },
    get currentConversationId(): string {
      return workspaceConversationId();
    },

    surface(surfaceId: string): SurfaceSpec | null {
      return getSurfaceSpec(surfaces.protocol, surfaceId);
    },

    send(text: string, images?: readonly ImageInput[]): void {
      if (tabsStore.activeConversationId === null) {
        // Draft: promote to tab on first send. Carry a Named Agent selection's
        // snapshot so the promoted conversation retains how it was selected (§7).
        const conversationId = registry.draftConversationId;
        const model = activeModel;
        const snapshot = namedAgentSnapshot ?? undefined;
        tabsStore.createTab({
          conversationId,
          model,
          title: deriveTitle(text),
          workspaceId: activeWorkspaceId,
          ...(snapshot ? { snapshot } : {}),
        });
        registry.chatStores.set(conversationId, registry.draftStore);

        // Prepare next draft
        const nextDraftId = randomId();
        registry.draftStore = registry.createChatFor(nextDraftId, activeModel, activeWorkspaceId);
        registry.draftConversationId = nextDraftId;

        registry.refreshActiveChat();
        // The draft became a real conversation: re-scope conversation-scoped
        // surfaces (e.g. cache-warming) to its id.
        surfaces.syncSubscriptions();
        void settings.refreshCwd();
        void settings.refreshComputer();
        void settings.refreshReasoningEffort();
        void settings.refreshThinking();
        void settings.refreshCompactPercent();
        // Now send on the promoted store
        registry.chatStores.get(conversationId)?.send(text, images);
      } else {
        registry.activeChat.send(text, images);
      }
    },

    queueMessage(text: string, images?: readonly ImageInput[]): void {
      // Only offered while generating (Composer switches to `chat.queue`
      // when `status === "running"`), so a draft (never generating) never
      // reaches here. `chat.queue` auto-starts a turn if idle, so even a race
      // (turn sealed between the status read and the send) is safe — the
      // server starts a fresh turn with the message as its opening prompt.
      registry.activeChat.queueMessage(text, images);
    },

    cancelQueuedMessage(messageId: string): void {
      // Fire-and-forget + idempotent. The message-queue surface (conversation-
      // scoped) reconciles the queue UI — the cancelled row leaves the snapshot.
      // A cancel of an already-drained / unknown message is a silent no-op, so
      // there is no local state to roll back. Delegates to the focused
      // conversation's chat store, which owns the conversationId + transport.
      registry.activeChat.cancelQueuedMessage(messageId);
    },

    selectModel(model: string, snapshot?: NamedAgentSelectionSnapshot): void {
      activeModel = model;
      namedAgentSnapshot = snapshot ?? null;
      const activeId = tabsStore.activeConversationId;
      if (activeId !== null) {
        tabsStore.setModel(activeId, model);
        tabsStore.setSnapshot(activeId, snapshot ?? null);
        registry.chatStores.get(activeId)?.setModel(model);
        registry.chatStores.get(activeId)?.setNamedAgent(snapshot ?? null);
        const body: SetModelRequest = { model, ...(snapshot ? { namedAgent: snapshot } : {}) };
        void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(activeId)}/model`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch((err) => {
          reportError("Failed to persist model", err);
        });
      } else {
        registry.draftStore.setModel(model);
        registry.draftStore.setNamedAgent(snapshot ?? null);
      }
    },

    newDraft(): void {
      tabsStore.newDraft();
      const nextDraftId = randomId();
      registry.draftStore = registry.createChatFor(nextDraftId, activeModel, activeWorkspaceId);
      registry.draftConversationId = nextDraftId;
      namedAgentSnapshot = null;
      registry.refreshActiveChat();
      surfaces.syncSubscriptions();
      void settings.refreshCwd();
      void settings.refreshComputer();
      void refreshModel();
      void settings.refreshReasoningEffort();
      void settings.refreshThinking();
      void settings.refreshCompactPercent();
    },

    selectTab(conversationId: string): void {
      tabsStore.selectTab(conversationId);
      const tab = tabsStore.tabs.find((t) => t.conversationId === conversationId);
      if (tab !== undefined) {
        activeModel = tab.model;
        namedAgentSnapshot = tab.snapshot ?? null;
      } else {
        namedAgentSnapshot = null;
      }
      registry.refreshActiveChat();
      surfaces.syncSubscriptions();
      void settings.refreshCwd();
      void settings.refreshComputer();
      void refreshModel();
      void settings.refreshReasoningEffort();
      void settings.refreshThinking();
      void settings.refreshCompactPercent();
    },

    closeTab(conversationId: string): void {
      // The user is DONE with this chat: abort any in-flight turn + stop/disable
      // its cache-warming, server-side (POST /close sets status → "closed").
      conversations.closeConversation(conversationId);
      conversations.removeTabLocally(conversationId);
    },

    renameTab: conversations.renameTab,
    setTabGroup: conversations.setTabGroup,

    invoke(surfaceId: string, actionId: string, payload?: unknown): void {
      surfaces.invokeSurfaceOp(surfaceId, actionId, payload);
    },

    subscribeSurface(surfaceId: string, conversationId?: string): void {
      surfaces.subscribeSurfaceOp(surfaceId, conversationId);
    },

    unsubscribeSurface(surfaceId: string, conversationId?: string): void {
      surfaces.unsubscribeSurfaceOp(surfaceId, conversationId);
    },

    warmNow: httpActions.warmNow,

    setCwd: settings.setCwd,

    setComputer: settings.setComputer,

    computerStatus: httpActions.computerStatus,

    testComputer: httpActions.testComputer,

    setReasoningEffort: settings.setReasoningEffort,

    setThinking: settings.setThinking,

    stopGeneration: httpActions.stopGeneration,

    compactNow: httpActions.compactNow,

    setCompactPercent: settings.setCompactPercent,

    setVisionSettings: settings.setVisionSettings,

    setChatLimit: registry.setChatLimit,

    lspStatus: settings.lspStatus,

    mcpStatus: settings.mcpStatus,

    heartbeatConfig: httpActions.heartbeatConfig,

    setHeartbeatConfig: httpActions.setHeartbeatConfig,

    heartbeatRuns: httpActions.heartbeatRuns,

    stopHeartbeatRun: httpActions.stopHeartbeatRun,

    heartbeatNextRun: httpActions.heartbeatNextRun,

    watchConversation(conversationId: string): ChatStore {
      return registry.watchConversation(conversationId);
    },

    unwatchConversation(conversationId: string): void {
      registry.unwatchConversation(conversationId);
    },

    // ── Concurrency (per-provider limits + live status; GLOBAL, not workspace-scoped)

    concurrencyLimits: httpActions.concurrencyLimits,

    getConcurrencyLimit: httpActions.getConcurrencyLimit,

    setConcurrencyLimit: httpActions.setConcurrencyLimit,

    deleteConcurrencyLimit: httpActions.deleteConcurrencyLimit,

    accountUsage: httpActions.accountUsage,

    setAccountUsageSettings: httpActions.setAccountUsageSettings,

    concurrencyStatus: httpActions.concurrencyStatus,

    searchBackendConfig: httpActions.searchBackendConfig,

    setSearchBackend: httpActions.setSearchBackend,

    getConcurrencyCooldown: httpActions.getConcurrencyCooldown,

    setConcurrencyCooldown: httpActions.setConcurrencyCooldown,

    loadSystemPrompt: httpActions.loadSystemPrompt,

    setSystemPrompt: httpActions.setSystemPrompt,

    loadSystemPromptVariables: httpActions.loadSystemPromptVariables,

    attachUnloadGate: registry.attachUnloadGate,

    // ── Named Agents (global config; plan §9) ────────────────────────────────

    get namedAgents(): readonly NamedAgent[] {
      return refreshers.namedAgents;
    },
    get namedAgentSnapshot(): NamedAgentSelectionSnapshot | null {
      return namedAgentSnapshot;
    },

    // ── Plugins (plan 07) ────────────────────────────────────────────────────
    get plugins(): PluginsStore {
      return pluginsStore;
    },
    get layout(): LayoutStore {
      return layoutStore;
    },
    get tileLayout(): TileLayoutStore {
      return tileLayoutStore;
    },
    get enabledProviderCount(): number | null {
      return refreshers.enabledProviderCount;
    },

    refreshNamedAgents: refreshers.refreshNamedAgents,

    createNamedAgent: refreshers.createNamedAgent,

    updateNamedAgent: refreshers.updateNamedAgent,

    deleteNamedAgent: refreshers.deleteNamedAgent,

    get fatalError(): string | null {
      return fatalError;
    },
    clearFatalError(): void {
      fatalError = null;
    },

    dispose(): void {
      registry.dispose();
      socket?.close();
      socket = null;
    },
  };
}
