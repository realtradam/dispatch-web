import type { StoredChunk } from "@dispatch/wire";
import { nextSinceSeq, reconcileCache, selectEvictions } from "./logic";
import type { ConversationChunkStore } from "./types";

export interface ConversationCache {
  historyEpoch(conversationId: string): Promise<number | undefined>;
  reset(conversationId: string, historyEpoch: number): Promise<void>;

  /** Load all cached chunks for a conversation. */
  load(conversationId: string): Promise<readonly StoredChunk[]>;

  /**
   * Load + reconcile + append new chunks.
   * Returns the merged cache (the new authoritative cache for this conversation).
   */
  commit(
    conversationId: string,
    incoming: readonly StoredChunk[],
    historyEpoch?: number,
  ): Promise<readonly StoredChunk[]>;

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

  // Serialize mutation per conversation, including invalidation, so an old fetch
  // cannot resurrect rows after a compaction broadcast has invalidated them.
  const pending = new Map<string, Promise<unknown>>();
  function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
    const next = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    pending.set(id, next);
    void next
      .finally(() => {
        if (pending.get(id) === next) pending.delete(id);
      })
      .catch(() => {});
    return next;
  }
  return {
    historyEpoch: async (id) => {
      await pending.get(id);
      return store.historyEpoch(id);
    },
    reset: (id, epoch) =>
      exclusive(id, async () => {
        const current = await store.historyEpoch(id);
        if (current === undefined || current < epoch) await store.reset(id, epoch);
      }),
    async load(conversationId) {
      await pending.get(conversationId);
      return store.load(conversationId);
    },

    commit(conversationId, incoming, epoch) {
      return exclusive(conversationId, async () => {
        if (epoch !== undefined) {
          const current = await store.historyEpoch(conversationId);
          if (current !== undefined && current > epoch) return store.load(conversationId);
          if (current !== epoch) await store.reset(conversationId, epoch);
        }
        const cached = await store.load(conversationId);
        const { merged, toAppend } = reconcileCache(cached, incoming);
        if (toAppend.length > 0) {
          await store.append(conversationId, toAppend);
        }
        return merged;
      });
    },

    async sinceSeq(conversationId) {
      await pending.get(conversationId);
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
      await exclusive(conversationId, () => store.delete(conversationId));
    },
  };
}
