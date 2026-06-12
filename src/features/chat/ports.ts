import type {
	ChatSendMessage,
	ConversationHistoryResponse,
	ConversationMetricsResponse,
} from "@dispatch/transport-contract";

/** Injected transport port — sends chat messages to the server. */
export interface ChatTransport {
	send(msg: ChatSendMessage): void;
}

/**
 * Optional windowing for a history fetch (transport-contract@0.10.0, CR-5).
 * Both must be POSITIVE integers when present (the server 400s otherwise).
 */
export interface HistoryWindow {
	/** Return only the NEWEST `limit` chunks of the selection (still ascending). */
	readonly limit?: number;
	/** Exclusive upper bound: only chunks with `seq < beforeSeq` (backfill paging). */
	readonly beforeSeq?: number;
}

/**
 * Injected history-sync port — fetches incremental history from the server
 * (`GET /conversations/:id?sinceSeq=&beforeSeq=&limit=`). NOTE the contract
 * caveat: on a windowed/backfill read the response's `latestSeq` describes the
 * returned window, not the conversation's high-water mark — never regress a
 * tail cursor from it (the FE's cursor comes from the cache's max seq, which
 * satisfies this naturally).
 */
export type HistorySync = (
	conversationId: string,
	sinceSeq: number,
	window?: HistoryWindow,
) => Promise<ConversationHistoryResponse>;

/** Injected metrics-sync port — fetches persisted per-turn metrics from the server. */
export type MetricsSync = (conversationId: string) => Promise<ConversationMetricsResponse>;
