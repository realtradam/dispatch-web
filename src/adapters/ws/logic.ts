import type {
  ChatDeltaMessage,
  ChatErrorMessage,
  ConversationCompactedMessage,
  ConversationOpenMessage,
  ConversationStatusChangedMessage,
  ExtensionsChangedMessage,
  LayoutChangedMessage,
  WsClientMessage,
  WsServerMessage,
} from "@dispatch/transport-contract";
import type {
  CatalogMessage,
  SurfaceErrorMessage,
  SurfaceMessage,
  SurfaceUpdateMessage,
} from "@dispatch/ui-contract";

const VALID_SERVER_TYPES = new Set([
  "catalog",
  "surface",
  "update",
  "error",
  "chat.delta",
  "chat.error",
  "conversation.open",
  "conversation.statusChanged",
  "conversation.compacted",
  "extensions-changed",
  "layout",
]);

/** Serialize a client message to a JSON string for the wire. */
export function serialize(msg: WsClientMessage): string {
  return JSON.stringify(msg);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Parse a raw server message string into a typed WsServerMessage.
 * Returns null for malformed JSON or shapes that don't match the protocol.
 */
export function parseServerMessage(data: string): WsServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const t = parsed.type;
  if (typeof t !== "string" || !VALID_SERVER_TYPES.has(t)) {
    return null;
  }
  switch (t) {
    case "catalog": {
      if (!Array.isArray(parsed.catalog)) return null;
      return { type: "catalog", catalog: parsed.catalog as CatalogMessage["catalog"] };
    }
    case "surface": {
      const spec = parsed.spec;
      if (!isRecord(spec)) return null;
      if (typeof spec.id !== "string") return null;
      if (typeof spec.region !== "string") return null;
      if (typeof spec.title !== "string") return null;
      if (!Array.isArray(spec.fields)) return null;
      // Preserve the conversationId echo (a conversation-scoped surface's initial
      // reply carries it) — dropping it would defeat the protocol reducer's
      // stale-scope filtering on a fast conversation switch.
      const conversationId = parsed.conversationId;
      if (conversationId !== undefined && typeof conversationId !== "string") return null;
      const surfaceSpec = spec as unknown as SurfaceMessage["spec"];
      return conversationId !== undefined
        ? { type: "surface", spec: surfaceSpec, conversationId }
        : { type: "surface", spec: surfaceSpec };
    }
    case "update": {
      const update = parsed.update;
      if (!isRecord(update)) return null;
      if (typeof update.surfaceId !== "string") return null;
      const spec = update.spec;
      if (!isRecord(spec)) return null;
      if (typeof spec.id !== "string") return null;
      if (typeof spec.region !== "string") return null;
      if (typeof spec.title !== "string") return null;
      if (!Array.isArray(spec.fields)) return null;
      return { type: "update", update: update as unknown as SurfaceUpdateMessage["update"] };
    }
    case "error": {
      if (typeof parsed.message !== "string") return null;
      const surfaceId = parsed.surfaceId;
      if (surfaceId !== undefined && typeof surfaceId !== "string") return null;
      const msg: SurfaceErrorMessage =
        surfaceId !== undefined
          ? { type: "error", surfaceId, message: parsed.message }
          : { type: "error", message: parsed.message };
      return msg;
    }
    case "chat.delta": {
      const event = parsed.event;
      if (!isRecord(event)) return null;
      if (typeof event.type !== "string") return null;
      return { type: "chat.delta", event: event as unknown as ChatDeltaMessage["event"] };
    }
    case "chat.error": {
      if (typeof parsed.message !== "string") return null;
      const conversationId = parsed.conversationId;
      if (conversationId !== undefined && typeof conversationId !== "string") return null;
      const msg: ChatErrorMessage =
        conversationId !== undefined
          ? { type: "chat.error", conversationId, message: parsed.message }
          : { type: "chat.error", message: parsed.message };
      return msg;
    }
    case "conversation.open": {
      if (typeof parsed.conversationId !== "string") return null;
      if (typeof parsed.workspaceId !== "string") return null;
      // Forward the persisted per-conversation model when the backend includes
      // it, so a client can stamp the opened tab with the conversation's ACTUAL
      // model (fix-toolcall-duplicate-keys plan Part 4).
      const model = parsed.model;
      const msg: ConversationOpenMessage = {
        type: "conversation.open",
        conversationId: parsed.conversationId,
        workspaceId: parsed.workspaceId,
        ...(typeof model === "string" && model.length > 0 ? { model } : {}),
      };
      return msg;
    }
    case "conversation.statusChanged": {
      if (typeof parsed.conversationId !== "string") return null;
      if (typeof parsed.status !== "string") return null;
      if (
        parsed.status !== "active" &&
        parsed.status !== "queued" &&
        parsed.status !== "idle" &&
        parsed.status !== "closed"
      ) {
        return null;
      }
      if (typeof parsed.workspaceId !== "string") return null;
      const msg: ConversationStatusChangedMessage = {
        type: "conversation.statusChanged",
        conversationId: parsed.conversationId,
        status: parsed.status,
        workspaceId: parsed.workspaceId,
      };
      return msg;
    }
    case "conversation.compacted": {
      if (typeof parsed.conversationId !== "string") return null;
      if (typeof parsed.newConversationId !== "string") return null;
      if (typeof parsed.messagesSummarized !== "number") return null;
      if (typeof parsed.messagesKept !== "number") return null;
      const msg: ConversationCompactedMessage = {
        type: "conversation.compacted",
        conversationId: parsed.conversationId,
        newConversationId: parsed.newConversationId,
        messagesSummarized: parsed.messagesSummarized,
        messagesKept: parsed.messagesKept,
      };
      return msg;
    }
    case "extensions-changed": {
      // Plugin-manager broadcast (plan 05): the payload is intentionally
      // minimal — clients refetch GET /plugins + the (server re-pushed)
      // surface catalog rather than diffing here.
      const action = parsed.action;
      if (action !== "load" && action !== "unload" && action !== "reload") {
        if (action !== "scan" && action !== "forget") return null;
      }
      const pluginId = parsed.pluginId;
      const msg: ExtensionsChangedMessage = {
        type: "extensions-changed",
        action,
        ...(pluginId !== undefined && typeof pluginId === "string" ? { pluginId } : {}),
      };
      return msg;
    }
    case "layout": {
      // Layout-provider broadcast (plan 02 §2.5): the FULL tree for ONE
      // workspace (decision 7 — no patch protocol). Light shape checks here
      // (the tree's structural validation is the backend's write-time job);
      // the store filters by its active workspace.
      if (typeof parsed.workspaceId !== "string") return null;
      const tree = parsed.tree;
      if (
        tree === null ||
        typeof tree !== "object" ||
        Array.isArray(tree) ||
        (tree as { version?: unknown }).version !== 1 ||
        typeof (tree as { root?: unknown }).root !== "object" ||
        (tree as { root?: unknown }).root === null
      ) {
        return null;
      }
      const msg: LayoutChangedMessage = {
        type: "layout",
        workspaceId: parsed.workspaceId,
        tree: tree as LayoutChangedMessage["tree"],
      };
      return msg;
    }
    default:
      return null;
  }
}

/**
 * Bounded exponential backoff with jitter.
 * Base: 500ms, doubles each attempt, caps at 30s, adds ±20% jitter.
 */
export function nextBackoffMs(attempt: number): number {
  const base = 500;
  const max = 30_000;
  const exponential = base * 2 ** Math.max(0, attempt);
  const capped = Math.min(exponential, max);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(capped * jitter);
}
