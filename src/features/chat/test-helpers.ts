import type { StoredChunk } from "@dispatch/wire";
import type { ConversationCache } from "../conversation-cache";
import type { ChatTransport, HistorySync, HistoryWindow, MetricsSync } from "./ports";

export interface FakeTransport {
	readonly sent: import("@dispatch/transport-contract").ChatSendMessage[];
	readonly impl: ChatTransport;
}

export function createFakeTransport(): FakeTransport {
	const sent: import("@dispatch/transport-contract").ChatSendMessage[] = [];
	return {
		sent,
		impl: {
			send(msg) {
				sent.push(msg);
			},
		},
	};
}

export interface FakeHistorySync {
	readonly calls: Array<{ conversationId: string; sinceSeq: number; window?: HistoryWindow }>;
	/** Set the chunks to return on the next call. */
	returnChunks: readonly StoredChunk[];
	readonly impl: HistorySync;
}

export function createFakeHistorySync(): FakeHistorySync {
	const calls: Array<{ conversationId: string; sinceSeq: number; window?: HistoryWindow }> = [];
	let returnChunks: readonly StoredChunk[] = [];
	return {
		calls,
		get returnChunks() {
			return returnChunks;
		},
		set returnChunks(v: readonly StoredChunk[]) {
			returnChunks = v;
		},
		impl: async (conversationId, sinceSeq, window) => {
			calls.push({ conversationId, sinceSeq, ...(window !== undefined ? { window } : {}) });
			// Apply the CR-5 WINDOW semantics (`beforeSeq` bound, then newest-`limit`)
			// so store tests exercise the real windowed flows. `sinceSeq` filtering is
			// deliberately NOT applied — tests set `returnChunks` to the slice they
			// mean the server to hold past the cursor.
			let chunks = returnChunks;
			const before = window?.beforeSeq;
			if (before !== undefined) {
				chunks = chunks.filter((c) => c.seq < before);
			}
			if (window?.limit !== undefined && chunks.length > window.limit) {
				chunks = chunks.slice(-window.limit);
			}
			const latestSeq = chunks.length > 0 ? Math.max(...chunks.map((c) => c.seq)) : sinceSeq;
			return { chunks, latestSeq };
		},
	};
}

export interface FakeMetricsSync {
	readonly calls: string[];
	returnTurns: import("@dispatch/wire").TurnMetrics[];
	/** If set, the next call will reject with this error. */
	nextError: string | undefined;
	readonly impl: MetricsSync;
}

export function createFakeMetricsSync(): FakeMetricsSync {
	const calls: string[] = [];
	let returnTurns: import("@dispatch/wire").TurnMetrics[] = [];
	let nextError: string | undefined;
	return {
		calls,
		get returnTurns() {
			return returnTurns;
		},
		set returnTurns(v: import("@dispatch/wire").TurnMetrics[]) {
			returnTurns = v;
		},
		get nextError() {
			return nextError;
		},
		set nextError(v: string | undefined) {
			nextError = v;
		},
		impl: async (conversationId) => {
			calls.push(conversationId);
			if (nextError !== undefined) {
				const err = nextError;
				nextError = undefined;
				throw new Error(err);
			}
			return { turns: returnTurns };
		},
	};
}

export interface FakeCache {
	readonly store: Map<string, StoredChunk[]>;
	readonly impl: ConversationCache;
}

export function createFakeCache(): FakeCache {
	const store = new Map<string, StoredChunk[]>();
	return {
		store,
		impl: {
			async load(conversationId) {
				return store.get(conversationId) ?? [];
			},
			async commit(conversationId, incoming) {
				const existing = store.get(conversationId) ?? [];
				const seen = new Set(existing.map((c) => c.seq));
				const toAppend = incoming.filter((c) => !seen.has(c.seq));
				const merged = [...existing, ...toAppend].sort((a, b) => a.seq - b.seq);
				store.set(conversationId, merged);
				return merged;
			},
			async sinceSeq(conversationId) {
				const chunks = store.get(conversationId) ?? [];
				if (chunks.length === 0) return 0;
				return Math.max(...chunks.map((c) => c.seq));
			},
			async evictIfOverBudget() {
				return [];
			},
			async delete(conversationId) {
				store.delete(conversationId);
			},
		},
	};
}
