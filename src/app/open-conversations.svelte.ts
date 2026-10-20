import type {
  ConversationListResponse,
  SetTabGroupRequest,
  SetTitleRequest,
  TabGroupResponse,
} from "@dispatch/transport-contract";
import type { ConversationStatus } from "@dispatch/wire";
import type { ConversationCache } from "../features/conversation-cache";
import type { TabsStore } from "../features/tabs";

import type { ChatRegistry } from "./chat-registry.svelte";
import type { createConversationSettings } from "./conversation-settings.svelte";

/** Cross-device tab discovery/reconciliation and backend lifecycle status. */
export function createOpenConversations(deps: {
  httpBase: string;
  fetchImpl: typeof fetch;
  tabsStore: TabsStore;
  registry: ChatRegistry;
  cache: ConversationCache;
  activeModel: () => string;
  settings: ReturnType<typeof createConversationSettings>;
  syncSubscriptions: () => void;
  reportError: (context: string, err: unknown) => void;
}) {
  const { httpBase, fetchImpl, tabsStore, registry, cache } = deps;
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
      deps.reportError("Failed to close conversation", err);
    });
  }

  /**
   * Open a conversation tab — used by the `conversation.open` WS broadcast
   * (CLI `--open` flag) and by `conversation.statusChanged` when a new active
   * conversation is discovered. If the conversation is already open, this is a
   * no-op; otherwise create a chat store, subscribe to its live
   * turns, and add the tab WITHOUT switching the active conversation (the user
   * stays on their current tab; the new tab appears in the strip). The tab is
   * stamped with the conversation's actual `workspaceId`, NOT the viewer's
   * currently active workspace.
   */
  function openConversation(
    conversationId: string,
    workspaceId: string,
    model?: string,
    tabGroupParentId?: string,
  ): void {
    if (registry.chatStores.has(conversationId)) return;
    // Stamp the tab with the conversation's PERSISTED model when the open
    // broadcast carries it (falling back to the current global selection) —
    // never let the globally-active model overwrite a conversation's real one
    // (fix-toolcall-duplicate-keys plan Part 4).
    const tabModel = model ?? deps.activeModel();
    const store =
      registry.watchStores.get(conversationId) ??
      registry.createChatFor(conversationId, tabModel, workspaceId);
    registry.watchStores.delete(conversationId);
    store.setModel(tabModel);
    registry.chatStores.set(conversationId, store);
    registry.subscribeChat(conversationId);
    tabsStore.openTab({
      conversationId,
      model: tabModel,
      title: "Conversation",
      workspaceId,
      ...(tabGroupParentId !== undefined ? { tabGroupParentId } : {}),
    });
  }

  /**
   * Remove a tab + its chat store locally (NO `POST /close` — used when the
   * backend already marked the conversation `closed` via `conversation.statusChanged`).
   */
  function removeTabLocally(conversationId: string): void {
    registry.unsubscribeChat(conversationId);
    const store = registry.chatStores.get(conversationId);
    if (store !== undefined) {
      store.dispose();
      registry.chatStores.delete(conversationId);
    }
    registry.loadedConversationIds.delete(conversationId);
    void cache.delete(conversationId);
    tabsStore.closeTab(conversationId);
    conversationStatuses.delete(conversationId);
    registry.refreshActiveChat();
    deps.syncSubscriptions();
    void deps.settings.refreshCwd();
    void deps.settings.refreshComputer();
    void deps.settings.refreshReasoningEffort();
    void deps.settings.refreshThinking();
    void deps.settings.refreshCompactPercent();
  }

  // Conversation lifecycle status (backend-owned, pushed via WS +
  // fetched on connect). Keyed by conversationId.
  let conversationStatuses = $state<Map<string, ConversationStatus>>(new Map());

  // The set of workspaces with ≥1 active/queued conversation, derived ONCE
  // (not recomputed per card). Every active/queued conversation has an open
  // tab stamped with its workspace, so the tabs are the conversation→workspace
  // map; cross-reference with the lifecycle statuses. `$derived` recomputes
  // lazily when the tab set or status map changes, so each
  // `workspaceHasActiveConversations` call is an O(1) lookup instead of a scan
  // of the full tab list per card.
  const activeWorkspaces = $derived.by(() => {
    const out = new Set<string>();
    for (const tab of tabsStore.tabs) {
      const status = conversationStatuses.get(tab.conversationId);
      if (status === "active" || status === "queued") out.add(tab.workspaceId);
    }
    return out;
  });

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

      if (!data || !Array.isArray(data.conversations)) {
        deps.reportError(
          "Failed to load open conversations",
          new Error("Invalid conversations response"),
        );
        return;
      }
      // Update the status map from the authoritative backend list.
      const newStatuses = new Map<string, ConversationStatus>();
      for (const conv of data.conversations) {
        newStatuses.set(conv.id, conv.status);
      }
      conversationStatuses = newStatuses;

      // Open tabs for conversations not already open.
      const existingIds = new Set(registry.chatStores.keys());
      for (const conv of data.conversations) {
        if (!existingIds.has(conv.id)) {
          // Stamp the tab with the conversation's PERSISTED model (when the
          // list carries it) instead of the global active model — the fix for
          // tabs showing/overwriting the wrong model
          // (fix-toolcall-duplicate-keys plan Part 4).
          const model = conv.model ?? deps.activeModel();
          const store =
            registry.watchStores.get(conv.id) ??
            registry.createChatFor(conv.id, model, conv.workspaceId);
          registry.watchStores.delete(conv.id);
          store.setModel(model);
          registry.chatStores.set(conv.id, store);
          // Seed the cache timer's turn gap (only an idle conversation is waiting on the user).
          if (conv.status === "idle") store.noteLastActivity(conv.lastActivityAt);
          registry.subscribeChat(conv.id);
          tabsStore.openTab({
            conversationId: conv.id,
            model,
            title: conv.title,
            workspaceId: conv.workspaceId,
            ...(conv.tabGroupParentId !== undefined
              ? { tabGroupParentId: conv.tabGroupParentId }
              : {}),
          });
        } else {
          // Already open — reconcile title + workspace from the authoritative
          // backend list. A raced `conversation.open` (summon) may have stamped
          // the tab with the wrong workspace ("default"); the backend's
          // authoritative conversation record is the source of truth, so a
          // differing tab workspace is corrected here.
          tabsStore.setTitle(conv.id, conv.title);
          // Seed the cache timer's turn gap from the backend (a tab restored
          // from localStorage at boot has no live `done` to go by). Only an
          // idle conversation is waiting on the user.
          if (conv.status === "idle")
            registry.chatStores.get(conv.id)?.noteLastActivity(conv.lastActivityAt);
          const tab = tabsStore.tabs.find((t) => t.conversationId === conv.id);
          if (tab?.workspaceId !== conv.workspaceId) {
            tabsStore.setWorkspaceId(conv.id, conv.workspaceId);
          }
          // The backend's EFFECTIVE tab group parent is authoritative too.
          if (tab?.tabGroupParentId !== conv.tabGroupParentId) {
            tabsStore.setTabGroupParent(conv.id, conv.tabGroupParentId ?? null);
          }
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
      deps.reportError(
        `Failed to load conversations from the backend.\n\nURL: ${httpBase}/conversations?status=active,idle`,
        err,
      );
    }
  }

  return {
    closeConversation,
    openConversation,
    removeTabLocally,
    fetchOpenConversations,
    renameTab(conversationId: string, title: string): void {
      tabsStore.setTitle(conversationId, title);
      void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(conversationId)}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title } satisfies SetTitleRequest),
      }).catch((err) => {
        deps.reportError("Failed to rename conversation", err);
      });
    },

    setTabGroup(conversationId: string, parentId: string | null): void {
      const previous =
        tabsStore.tabs.find((t) => t.conversationId === conversationId)?.tabGroupParentId ?? null;
      tabsStore.setTabGroupParent(conversationId, parentId);
      void (async () => {
        try {
          const res = await fetchImpl(
            `${httpBase}/conversations/${encodeURIComponent(conversationId)}/tab-group`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ parentId } satisfies SetTabGroupRequest),
            },
          );
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(err?.error ?? `HTTP ${res.status}`);
          }
          const body = (await res.json()) as TabGroupResponse;
          tabsStore.setTabGroupParent(conversationId, body.tabGroupParentId);
        } catch (err) {
          // Revert the optimistic move, then surface the failure.
          tabsStore.setTabGroupParent(conversationId, previous);
          deps.reportError("Failed to update the tab's subagent group", err);
        }
      })();
    },

    get conversationStatuses() {
      return conversationStatuses;
    },
    set conversationStatuses(value: Map<string, ConversationStatus>) {
      conversationStatuses = value;
    },
    conversationStatus(conversationId: string): ConversationStatus | undefined {
      return conversationStatuses.get(conversationId);
    },
    workspaceHasActiveConversations(workspaceId: string): boolean {
      return activeWorkspaces.has(workspaceId);
    },
  };
}
export type OpenConversations = ReturnType<typeof createOpenConversations>;
