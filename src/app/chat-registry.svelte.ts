import { untrack } from "svelte";
import { createLocalStore } from "../adapters/local-storage";
import type { SurfaceSocketHandle } from "../adapters/ws";
import { normalizeChatLimit } from "../core/chunks";
import type { ChatStore, HistorySync, MetricsSync } from "../features/chat";
import { createChatStore } from "../features/chat";
import type { ConversationCache } from "../features/conversation-cache";
import type { TabsStore } from "../features/tabs";
import type { ChatLimitResult, CreateAppStoreOptions } from "./store-types";
import { randomId } from "./uuid";

/** App-owned tab/watch stores and idempotent transcript loading; no singleton state. */
export function createChatRegistry(deps: {
  storage: Storage | undefined;
  tabsStore: TabsStore;
  createCache: () => ConversationCache;
  historySync: HistorySync;
  metricsSync: MetricsSync;
  defaultModel: string;
  activeModel: () => string;
  activeWorkspaceId: () => string;
  send: SurfaceSocketHandle["send"];
  reportError: (context: string, err: unknown) => void;
  chatFlushScheduler: CreateAppStoreOptions["chatFlushScheduler"];
}) {
  // The chat limit (max loaded chunks per conversation) — a persisted local
  // setting surfaced in the sidebar's Settings view. Reactive so the field +
  // any live-apply re-trim update together. The default is written back on
  // first run so the knob is discoverable in localStorage too.
  const chatLimitStore = createLocalStore<number>("dispatch.chatLimit", {
    storage: deps.storage,
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

  const cache = deps.createCache();

  const chatStores = new Map<string, ChatStore>();
  // Includes in-flight loads: repeated activation must not start a second load.
  const loadedConversationIds = new Set<string>();

  // Ephemeral chat stores for MODAL viewers (the heartbeat run-chat modal): a
  // watch on a conversation's live turn stream WITHOUT opening a tab. Separate
  // from `chatStores` (tabs) so closing a modal never disturbs the tab strip,
  // and a tab's conversation reuses its own store (see `watchConversation`).
  // Deltas are routed here in addition to `chatStores`.
  const watchStores = new Map<string, ChatStore>();

  /**
   * Coalesce live chat events to at most one fold + render per animation
   * frame (a late-join replay of a long turn arrives as a burst of WS frames;
   * folding each separately re-derives the whole transcript per frame). A
   * timeout backs up rAF, which browsers pause in hidden tabs — a backgrounded
   * tab still applies its events (just less often).
   */
  function scheduleChatFlush(flush: () => void): void {
    let ran = false;
    const run = (): void => {
      if (ran) return;
      ran = true;
      flush();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    setTimeout(run, 250);
  }

  const chatFlushScheduler =
    deps.chatFlushScheduler === undefined ? scheduleChatFlush : deps.chatFlushScheduler;

  function createChatFor(conversationId: string, model: string, workspaceId: string): ChatStore {
    return createChatStore({
      conversationId,
      model,
      workspaceId,
      transport: {
        send(msg) {
          deps.send(msg);
        },
      },
      historySync: deps.historySync,
      metricsSync: deps.metricsSync,
      cache,
      // Read from the persisted store (kept in sync with the reactive `chatLimit`
      // by `setChatLimit` + boot) so this snapshot doesn't reference the `$state`
      // — each store captures its limit at creation; live updates go through
      // `setChatLimit`.
      chatLimit: normalizeChatLimit(chatLimitStore.load()),
      canUnload: () => (unloadGate === null ? true : unloadGate()),
      ...(chatFlushScheduler !== null ? { scheduleFlush: chatFlushScheduler } : {}),
      onError: (context, err) => {
        deps.reportError(`${context} (conversation: ${conversationId})`, err);
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
    deps.defaultModel,
    untrack(deps.activeWorkspaceId),
  );
  let draftConversationId: string = initialDraftId;

  let activeChat = $state<ChatStore>(draftStore as ChatStore);
  function getActiveChat(): ChatStore {
    const activeId = deps.tabsStore.activeConversationId;
    if (activeId === null) {
      return draftStore;
    }
    return chatStores.get(activeId) ?? draftStore;
  }

  function ensureLoaded(conversationId: string): void {
    if (loadedConversationIds.has(conversationId)) return;
    const store = chatStores.get(conversationId) ?? watchStores.get(conversationId);
    if (store === undefined) return;
    loadedConversationIds.add(conversationId);
    void store.load();
  }

  function refreshActiveChat(): void {
    const activeId = deps.tabsStore.activeConversationId;
    if (activeId !== null) ensureLoaded(activeId);
    activeChat = getActiveChat();
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
    deps.send({ type: "chat.subscribe", conversationId });
  }

  /** Stop watching a conversation's turn events (`chat.unsubscribe`). Never stops the turn. */
  function unsubscribeChat(conversationId: string): void {
    deps.send({ type: "chat.unsubscribe", conversationId });
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
    if (tabStore !== undefined) {
      ensureLoaded(conversationId);
      return tabStore;
    }
    const existing = watchStores.get(conversationId);
    if (existing !== undefined) return existing;
    const store = createChatFor(conversationId, deps.activeModel(), deps.activeWorkspaceId());
    watchStores.set(conversationId, store);
    ensureLoaded(conversationId);
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
    loadedConversationIds.delete(conversationId);
    unsubscribeChat(conversationId);
  }

  return {
    cache,
    chatStores,
    watchStores,
    loadedConversationIds,
    createChatFor,
    ensureLoaded,
    getActiveChat,
    refreshActiveChat,
    subscribeChat,
    unsubscribeChat,
    watchConversation,
    unwatchConversation,
    get draftStore() {
      return draftStore;
    },
    set draftStore(value: ChatStore) {
      draftStore = value;
    },
    get draftConversationId() {
      return draftConversationId;
    },
    set draftConversationId(value: string) {
      draftConversationId = value;
    },
    get activeChat() {
      return activeChat;
    },
    get chatLimit() {
      return chatLimit;
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
    attachUnloadGate(gate: () => boolean): void {
      unloadGate = gate;
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
      loadedConversationIds.clear();
      draftStore.dispose();
    },
  };
}
export type ChatRegistry = ReturnType<typeof createChatRegistry>;
