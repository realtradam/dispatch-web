import type {
  ChatAcceptedMessage,
  ChatDeltaMessage,
  ChatErrorMessage,
  ChatQueuedMessage,
  ChatResyncRequiredMessage,
  ChatSubscriptionRejectedMessage,
  ConversationCompactedMessage,
  ConversationOpenMessage,
  ConversationStatusChangedMessage,
  ConversationTabGroupChangedMessage,
  ExtensionsChangedMessage,
  LayoutChangedMessage,
  TileLayoutChangedMessage,
  WorkspaceSetMessage,
} from "@dispatch/transport-contract";
import type { SubscribeMessage } from "@dispatch/ui-contract";
import type { SurfaceSocketHandle, SurfaceSocketOptions } from "../adapters/ws";
import type { ConversationCache } from "../features/conversation-cache";
import type { LayoutStore } from "../features/layout";
import type { PluginsStore } from "../features/plugins";
import type { TabsStore } from "../features/tabs";
import type { TileLayoutStore } from "../features/workspaces";
import type { ChatRegistry } from "./chat-registry.svelte";
import type { OpenConversations } from "./open-conversations.svelte";
import type { createPluginHost } from "./plugin-host.svelte";
import type { createSettingsRefreshers } from "./settings-refreshers.svelte";
import type { createSurfaceProtocol } from "./surface-protocol.svelte";

/** Typed socket callbacks over explicitly injected app-owned instances. */
export function createWsHandlers(deps: {
  url: string;
  send: SurfaceSocketHandle["send"];
  registry: ChatRegistry;
  conversations: OpenConversations;
  surfaces: ReturnType<typeof createSurfaceProtocol>;
  cache: ConversationCache;
  tabsStore: TabsStore;
  activeWorkspaceId: () => string;
  workspaceSetMsg: (workspaceId: string) => WorkspaceSetMessage;
  pluginsStore: PluginsStore;
  pluginHost: ReturnType<typeof createPluginHost>;
  layoutStore: LayoutStore;
  tileLayoutStore: TileLayoutStore;
  refreshers: ReturnType<typeof createSettingsRefreshers>;
  reportError: (context: string, err: unknown) => void;
}): SurfaceSocketOptions {
  const {
    registry,
    conversations,
    surfaces,
    cache,
    tabsStore,
    pluginsStore,
    pluginHost,
    layoutStore,
    tileLayoutStore,
  } = deps;
  function handleChatMessage(
    msg:
      | ChatAcceptedMessage
      | ChatSubscriptionRejectedMessage
      | ChatDeltaMessage
      | ChatErrorMessage
      | ChatQueuedMessage
      | ChatResyncRequiredMessage,
  ): void {
    let targetId: string | undefined;
    if (msg.type === "chat.delta") {
      targetId = msg.event.conversationId;
    } else {
      targetId = msg.conversationId;
    }

    if (targetId !== undefined) {
      const store = registry.chatStores.get(targetId) ?? registry.watchStores.get(targetId);
      if (store !== undefined) {
        store.handleDelta(msg);
        return;
      }
    }

    if (
      msg.type === "chat.accepted" ||
      msg.type === "chat.subscription-rejected" ||
      msg.type === "chat.queued" ||
      msg.type === "chat.resync-required"
    )
      return;

    // fallback: try all stores (chat.error without conversationId)
    for (const store of registry.chatStores.values()) {
      store.handleDelta(msg);
    }
    for (const store of registry.watchStores.values()) {
      store.handleDelta(msg);
    }
  }

  return {
    url: deps.url,
    onMessage: surfaces.handleServerMessage,
    onChat: handleChatMessage,
    onConversationOpen(msg: ConversationOpenMessage): void {
      conversations.openConversation(
        msg.conversationId,
        msg.workspaceId,
        msg.model,
        msg.tabGroupParentId,
      );
    },
    onConversationTabGroupChanged(msg: ConversationTabGroupChangedMessage): void {
      // Another client (or this one, echoed) regrouped a tab — apply the
      // authoritative EFFECTIVE value. Unknown tabs are a reducer no-op.
      tabsStore.setTabGroupParent(msg.conversationId, msg.tabGroupParentId);
    },
    onConversationStatusChanged(msg: ConversationStatusChangedMessage): void {
      const { conversationId, status, workspaceId } = msg;
      if (status === "closed") {
        // Closed on another device (or the backend) — remove the tab locally.
        if (registry.chatStores.has(conversationId)) {
          conversations.removeTabLocally(conversationId);
        }
        return;
      }
      // active / queued / idle — update the status map (drives the tab spinner).
      // `queued` = the turn is in flight but waiting for a concurrency slot
      // (broadcast-only, never persisted — CR-13); the tab shows a ring.
      conversations.conversationStatuses = new Map(conversations.conversationStatuses).set(
        conversationId,
        status,
      );
      // Reconcile the already-open tab's workspace from this authoritative
      // lifecycle event (the payload workspace is the conversation's actual
      // persisted workspace). A raced `conversation.open` may have stamped the
      // wrong workspace ("default") — correct it here.
      if (
        registry.chatStores.has(conversationId) &&
        (tabsStore.tabs.find((t) => t.conversationId === conversationId)?.workspaceId ??
          workspaceId) !== workspaceId
      ) {
        tabsStore.setWorkspaceId(conversationId, workspaceId);
      }
      // If this is a new active OR queued conversation we don't have a tab for,
      // open one — so a cross-device turn (incl. one waiting in the concurrency
      // queue) is visible. `idle` never opens a tab.
      if (
        (status === "active" || status === "queued") &&
        !registry.chatStores.has(conversationId)
      ) {
        conversations.openConversation(conversationId, workspaceId);
      }
    },
    onConversationCompacted(msg: ConversationCompactedMessage): void {
      const cid = msg.conversationId;
      const store = registry.chatStores.get(cid) ?? registry.watchStores.get(cid);
      if (store && registry.loadedConversationIds.has(cid)) {
        store.resync(msg.historyEpoch);
      } else {
        store?.invalidateHistory(msg.historyEpoch);
        // Unseen conversations stay lazy. Invalidation is queued before their
        // next load; epoch-guarded commits reject any older in-flight response.
        void cache
          .reset(cid, msg.historyEpoch)
          .catch((err) => deps.reportError("Failed to reset conversation cache", err));
      }
    },
    onReopen() {
      // The server forgot our subscriptions on reconnect; re-send each with the
      // conversation it was subscribed under (protocolSubscribe would no-op since
      // they're still in our local map, so emit the wire messages directly).
      for (const [surfaceId, sub] of surfaces.protocol.subscriptions) {
        const msg: SubscribeMessage =
          sub.conversationId === undefined
            ? { type: "subscribe", surfaceId }
            : { type: "subscribe", surfaceId, conversationId: sub.conversationId };
        deps.send(msg);
      }
      // A reconnect is a NEW connection — the server forgot this client's
      // workspace too. Re-declare it so the re-pushed catalog is filtered
      // (plan 06 §6.4).
      deps.send(deps.workspaceSetMsg(deps.activeWorkspaceId()));
      registry.reconnect();
      void conversations.fetchOpenConversations();
    },
    onExtensionsChanged(_msg: ExtensionsChangedMessage) {
      // §11 multi-client coherence: another client (or this one) mutated the
      // plugin set. Refetch the plugin list (+ any open workspace modal view),
      // the workspace-scoped model catalog, and the provider guardrail. The
      // surface catalog is NOT refetched here — the server re-pushes it
      // (workspace-filtered) on the same broadcast.
      pluginsStore.onExtensionsChanged();
      // Frontend plugins (plan 03): the load lifecycle's extensions-changed
      // trigger — newly-loaded/enabled frontend plugins import + activate;
      // unloaded/disabled ones are swept (their tiles fall back).
      void pluginHost.sync();
      // A layout plugin enabled/disabled mid-session starts/stops serving —
      // the probe picks the new provider state up without a reload (§2.6).
      void layoutStore.probe(deps.activeWorkspaceId());
      void deps.refreshers.refreshModels();
      void deps.refreshers.refreshProviderStatus();
    },
    onLayout(msg: LayoutChangedMessage) {
      // §2.5 multi-client coherence: a layout write on ANY client (or a
      // plugin's op) re-renders here — the store filters non-active
      // workspaces (the server fans out to everyone).
      layoutStore.onServerTree(msg.workspaceId, msg.tree);
    },
    onTileLayout(msg: TileLayoutChangedMessage) {
      // Multi-client coherence for the home grid's synced layouts: a write
      // on ANY client re-renders here — the store filters the OTHER
      // orientation (the server fans out to everyone).
      tileLayoutStore.onServerTileLayout(msg.mode, msg.data);
    },
  };
}
