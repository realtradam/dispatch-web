import type { StoredChunk } from "@dispatch/wire";

/** Metadata entry for a cached conversation, used by eviction logic. */
export interface ConversationCacheIndexEntry {
	readonly conversationId: string;
	readonly chunkCount: number;
	readonly maxSeq: number;
	readonly lastAccess?: number;
}

/**
 * Storage port for conversation chunk persistence.
 *
 * The IndexedDB implementation lives in `src/adapters/idb/` (separate unit);
 * this interface is the contract the cache logic depends on.
 *
 * All methods MUST be idempotent on `seq`: re-appending an existing seq is a no-op.
 */
export interface ConversationChunkStore {
	/** Load all cached chunks for a conversation, seq-ordered. Returns [] if absent. */
	load(conversationId: string): Promise<readonly StoredChunk[]>;

	/**
	 * Append committed chunks to a conversation's cache.
	 * MUST be idempotent on `seq`: re-appending an existing seq is a no-op.
	 */
	append(conversationId: string, chunks: readonly StoredChunk[]): Promise<void>;

	/** Delete all cached data for a conversation. */
	delete(conversationId: string): Promise<void>;

	/** Return metadata for all cached conversations (for eviction). */
	index(): Promise<readonly ConversationCacheIndexEntry[]>;
}

/** Result of reconciling cached chunks with incoming authoritative chunks. */
export interface ReconcileResult {
	/** The merged, deduplicated, seq-ordered chunk list. */
	readonly merged: readonly StoredChunk[];
	/** The subset of incoming chunks that need to be appended (not already cached). */
	readonly toAppend: readonly StoredChunk[];
}
