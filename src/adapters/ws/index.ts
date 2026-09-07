import type {
  ChatDeltaMessage,
  ChatErrorMessage,
  ConversationCompactedMessage,
  ConversationOpenMessage,
  ConversationStatusChangedMessage,
  ExtensionsChangedMessage,
  LayoutChangedMessage,
  TileLayoutChangedMessage,
  WsClientMessage,
} from "@dispatch/transport-contract";
import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { nextBackoffMs, parseServerMessage, serialize } from "./logic";

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
}

export interface SurfaceSocketOptions {
  url: string;
  onMessage: (msg: SurfaceServerMessage) => void;
  onChat?: (msg: ChatDeltaMessage | ChatErrorMessage) => void;
  /** Broadcast when a conversation is "opened" (e.g. CLI `--open` flag). */
  onConversationOpen?: (msg: ConversationOpenMessage) => void;
  /** Broadcast when a conversation's lifecycle status changes (active/idle/closed). */
  onConversationStatusChanged?: (msg: ConversationStatusChangedMessage) => void;
  /** Broadcast when a conversation's history has been compacted (reload needed). */
  onConversationCompacted?: (msg: ConversationCompactedMessage) => void;
  /**
   * Broadcast after every plugin-manager mutation (plan 05 §11): every
   * connected frontend refetches its extension list (the server re-pushes the
   * workspace-filtered surface catalog itself).
   */
  onExtensionsChanged?: (msg: ExtensionsChangedMessage) => void;
  /**
   * Broadcast after every successful layout write (plan 02 §2.5): the FULL
   * tree for one workspace. The consumer filters by its active workspace.
   */
  onLayout?: (msg: LayoutChangedMessage) => void;
  /**
   * Broadcast after every successful home tile-layout write: the FULL
   * document for one device orientation (wide/tall). The consumer filters by
   * its active geometry mode.
   */
  onTileLayout?: (msg: TileLayoutChangedMessage) => void;
  onReopen?: () => void;
  socketFactory?: (url: string) => WebSocketLike;
}

export interface SurfaceSocketHandle {
  send(msg: WsClientMessage): void;
  close(): void;
}

export function createSurfaceSocket(opts: SurfaceSocketOptions): SurfaceSocketHandle {
  const factory =
    opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);

  let socket: WebSocketLike | null = null;
  let disposed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isOpen = false;
  const queue: string[] = [];

  function connect(isReconnect: boolean): void {
    socket = factory(opts.url);
    isOpen = false;

    socket.onopen = () => {
      if (disposed) return;
      isOpen = true;
      reconnectAttempt = 0;
      for (const raw of queue.splice(0)) {
        socket?.send(raw);
      }
      if (isReconnect) {
        opts.onReopen?.();
      }
    };

    socket.onmessage = (ev) => {
      if (disposed) return;
      const msg = parseServerMessage(ev.data);
      if (msg !== null) {
        if (msg.type === "chat.delta" || msg.type === "chat.error") {
          opts.onChat?.(msg as ChatDeltaMessage | ChatErrorMessage);
        } else if (msg.type === "conversation.open") {
          opts.onConversationOpen?.(msg as ConversationOpenMessage);
        } else if (msg.type === "conversation.statusChanged") {
          opts.onConversationStatusChanged?.(msg as ConversationStatusChangedMessage);
        } else if (msg.type === "conversation.compacted") {
          opts.onConversationCompacted?.(msg as ConversationCompactedMessage);
        } else if (msg.type === "extensions-changed") {
          opts.onExtensionsChanged?.(msg as ExtensionsChangedMessage);
        } else if (msg.type === "layout") {
          opts.onLayout?.(msg as LayoutChangedMessage);
        } else if (msg.type === "tile-layout") {
          opts.onTileLayout?.(msg as TileLayoutChangedMessage);
        } else {
          opts.onMessage(msg as SurfaceServerMessage);
        }
      }
    };

    socket.onclose = () => {
      if (disposed) return;
      isOpen = false;
      scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    const delay = nextBackoffMs(reconnectAttempt);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) return;
      connect(true);
    }, delay);
  }

  connect(false);

  return {
    send(msg: WsClientMessage): void {
      if (disposed) return;
      const raw = serialize(msg);
      if (isOpen) {
        socket?.send(raw);
      } else {
        queue.push(raw);
      }
    },
    close(): void {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
    },
  };
}
