import type { SurfaceServerMessage, SurfaceSpec } from "@dispatch/ui-contract";
import type { SurfaceSocketHandle } from "../adapters/ws";
import {
  applyServerMessage,
  getSurfaceSpec,
  type ProtocolState,
  initialState as protocolInitialState,
  invoke as protocolInvoke,
  subscribe as protocolSubscribe,
  unsubscribe as protocolUnsubscribe,
} from "../core/protocol";
import { MAX_SURFACE_SUBSCRIPTIONS } from "./subscription-budget";

/** Shared app/plugin surface operations over the single app protocol state. */
export function createSurfaceProtocol(deps: {
  focusedConversationId: () => string | undefined;
  send: SurfaceSocketHandle["send"];
}) {
  let protocol = $state<ProtocolState>(protocolInitialState());
  // Rendering may retain the prior spec during re-scope. Consumers making
  // conversation-specific decisions can opt into a snapshot with a known scope.
  let receivedScopes = $state<ReadonlyMap<string, string | undefined>>(new Map());
  function handleServerMessage(msg: SurfaceServerMessage): void {
    const next = applyServerMessage(protocol, msg);
    if (next !== protocol && (msg.type === "surface" || msg.type === "update")) {
      const snapshot = msg.type === "surface" ? msg : msg.update;
      const scopes = new Map(receivedScopes);
      scopes.set(snapshot.spec.id, snapshot.conversationId);
      receivedScopes = scopes;
    }
    protocol = next;
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
    const cid = deps.focusedConversationId();
    const catalogIds = new Set(
      protocol.catalog.slice(0, MAX_SURFACE_SUBSCRIPTIONS).map((e) => e.id),
    );
    for (const id of [...protocol.subscriptions.keys()]) {
      if (!catalogIds.has(id)) {
        const result = protocolUnsubscribe(protocol, id);
        protocol = result.state;
        for (const msg of result.outgoing) {
          deps.send(msg);
        }
      }
    }
    for (const entry of protocol.catalog.slice(0, MAX_SURFACE_SUBSCRIPTIONS)) {
      // A GLOBAL surface ignores conversation scope — subscribe it WITHOUT an id
      // so a conversation switch doesn't churn a redundant unsubscribe+subscribe
      // round trip (ui-contract@0.2.0 catalog `scope`; ABSENT = assume
      // conversation-scoped, the conservative pre-0.2.0 policy).
      const scoped = entry.scope === "global" ? undefined : cid;
      const result = protocolSubscribe(protocol, entry.id, scoped);
      protocol = result.state;
      for (const msg of result.outgoing) {
        deps.send(msg);
      }
    }
    receivedScopes = new Map([...receivedScopes].filter(([id]) => protocol.subscriptions.has(id)));
  }

  /**
   * The surface OP implementations — closure functions shared by the app
   * store's public methods AND the frontend-plugin ABI's surfaces ports (the
   * plugin host binds exactly these; there is no second protocol state).
   */
  function invokeSurfaceOp(
    surfaceId: string,
    actionId: string,
    payload?: unknown,
    conversationId?: string,
  ): void {
    const result = protocolInvoke(
      protocol,
      surfaceId,
      actionId,
      payload,
      conversationId ?? deps.focusedConversationId(),
    );
    protocol = result.state;
    for (const msg of result.outgoing) {
      deps.send(msg);
    }
  }

  function subscribeSurfaceOp(surfaceId: string, conversationId?: string): void {
    if (
      !protocol.subscriptions.has(surfaceId) &&
      protocol.subscriptions.size >= MAX_SURFACE_SUBSCRIPTIONS
    )
      return;
    const result = protocolSubscribe(
      protocol,
      surfaceId,
      conversationId ?? deps.focusedConversationId(),
    );
    protocol = result.state;
    for (const msg of result.outgoing) {
      deps.send(msg);
    }
  }

  function unsubscribeSurfaceOp(surfaceId: string, conversationId?: string): void {
    // protocolUnsubscribe keys on the surface alone (it drops the pair it
    // was subscribed under); the optional id documents the intent.
    void conversationId;
    const result = protocolUnsubscribe(protocol, surfaceId);
    protocol = result.state;
    const scopes = new Map(receivedScopes);
    scopes.delete(surfaceId);
    receivedScopes = scopes;
    for (const msg of result.outgoing) {
      deps.send(msg);
    }
  }

  function surfaceSpecOp(surfaceId: string, conversationId?: string): SurfaceSpec | null {
    if (conversationId !== undefined && receivedScopes.get(surfaceId) !== conversationId)
      return null;
    return getSurfaceSpec(protocol, surfaceId);
  }

  return {
    handleServerMessage,
    syncSubscriptions,
    invokeSurfaceOp,
    subscribeSurfaceOp,
    unsubscribeSurfaceOp,
    surfaceSpecOp,
    get protocol() {
      return protocol;
    },
  };
}
