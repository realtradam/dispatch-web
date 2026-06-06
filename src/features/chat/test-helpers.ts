import type { StoredChunk } from "@dispatch/wire";
import type { ConversationCache } from "../conversation-cache";
import type { ChatTransport, HistorySync } from "./ports";

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
	readonly calls: Array<{ conversationId: string; sinceSeq: number }>;
	/** Set the chunks to return on the next call. */
	returnChunks: readonly StoredChunk[];
	readonly impl: HistorySync;
}

export function createFakeHistorySync(): FakeHistorySync {
	const calls: Array<{ conversationId: string; sinceSeq: number }> = [];
	let returnChunks: readonly StoredChunk[] = [];
	return {
		calls,
		get returnChunks() {
			return returnChunks;
		},
		set returnChunks(v: readonly StoredChunk[]) {
			returnChunks = v;
		},
		impl: async (conversationId, sinceSeq) => {
			calls.push({ conversationId, sinceSeq });
			const chunks = returnChunks;
			const latestSeq = chunks.length > 0 ? Math.max(...chunks.map((c) => c.seq)) : sinceSeq;
			return { chunks, latestSeq };
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
		},
	};
}
