import type {
	ChatSendMessage,
	ConversationHistoryResponse,
	ConversationMetricsResponse,
} from "@dispatch/transport-contract";

/** Injected transport port — sends chat messages to the server. */
export interface ChatTransport {
	send(msg: ChatSendMessage): void;
}

/** Injected history-sync port — fetches incremental history from the server. */
export type HistorySync = (
	conversationId: string,
	sinceSeq: number,
) => Promise<ConversationHistoryResponse>;

/** Injected metrics-sync port — fetches persisted per-turn metrics from the server. */
export type MetricsSync = (conversationId: string) => Promise<ConversationMetricsResponse>;
