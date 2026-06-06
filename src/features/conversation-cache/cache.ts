import type { StoredChunk } from "@dispatch/wire";
import { nextSinceSeq, reconcileCache, selectEvictions } from "./logic";
import type { ConversationChunkStore } from "./types";

export interface ConversationCache {
	/** Load all cached chunks for a conversation. */
	load(conversationId: string): Promise<readonly StoredChunk[]>;

	/**
	 * Load + reconcile + append new chunks.
	 * Returns the merged cache (the new authoritative cache for this conversation).
	 */
	commit(conversationId: string, incoming: readonly StoredChunk[]): Promise<readonly StoredChunk[]>;

	/** Return the `?sinceSeq=` cursor for the next incremental sync. */
	sinceSeq(conversationId: string): Promise<number>;

	/**
	 * Evict conversations over budget.
	 * Returns the evicted conversationIds.
	 */
	evictIfOverBudget(activeConversationId: string | null): Promise<readonly string[]>;

	/** Delete all cached data for a single conversation (local forget). */
	delete(conversationId: string): Promise<void>;
}

export interface ConversationCacheOptions {
	/** Maximum total chunks across all conversations before eviction triggers. */
	readonly maxChunks?: number;
}

const DEFAULT_MAX_CHUNKS = 10_000;

/**
 * Create a conversation cache backed by the injected storage port.
 *
 * The ONLY impurity is the injected `store`; all logic delegates to pure functions.
 */
export function createConversationCache(
	store: ConversationChunkStore,
	opts?: ConversationCacheOptions,
): ConversationCache {
	const maxChunks = opts?.maxChunks ?? DEFAULT_MAX_CHUNKS;

	return {
		async load(conversationId) {
			return store.load(conversationId);
		},

		async commit(conversationId, incoming) {
			const cached = await store.load(conversationId);
			const { merged, toAppend } = reconcileCache(cached, incoming);
			if (toAppend.length > 0) {
				await store.append(conversationId, toAppend);
			}
			return merged;
		},

		async sinceSeq(conversationId) {
			const cached = await store.load(conversationId);
			return nextSinceSeq(cached);
		},

		async evictIfOverBudget(activeConversationId) {
			const idx = await store.index();
			const toEvict = selectEvictions(idx, { maxChunks, activeConversationId });
			for (const id of toEvict) {
				await store.delete(id);
			}
			return toEvict;
		},

		async delete(conversationId) {
			await store.delete(conversationId);
		},
	};
}
