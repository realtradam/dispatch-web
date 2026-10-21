import type { ChatQueueMessage, ChatSendMessage } from "@dispatch/transport-contract";

/** A saved copy, never automatically retransmitted: requestId is not idempotent. */
export interface PendingInput {
  readonly request: (ChatSendMessage | ChatQueueMessage) & { readonly requestId: string };
  readonly rejection?: string;
}

export interface PendingInputStorage {
  load(): readonly PendingInput[];
  save(inputs: readonly PendingInput[]): void;
}
