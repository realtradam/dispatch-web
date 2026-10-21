import type { StoredChunk } from "@dispatch/wire";
import { nextSinceSeq, reconcileCache, selectEvictions } from "./logic";
import type { ConversationChunkStore } from "./types";

export interface ConversationCache {
  historyEpoch(conversationId: string): Promise<number | undefined>;
  reset(conversationId: string, historyEpoch: number): Promise<void>;

  /**
   * Replace from a fresh full-history response, including an epoch decrease.
   * Only succeeds if the cache still has the epoch observed BEFORE that request.
   * Unlike monotonic reset/commit, this is for confirmed server authority, not
   * broadcasts or cursor/backfill responses. False means the response is stale.
   */
  replace(
    conversationId: string,
    incoming: readonly StoredChunk[],
    historyEpoch: number,
    expectedEpoch: number | undefined,
  ): Promise<boolean>;

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
    replace: (id, incoming, epoch, expectedEpoch) =>
      exclusive(id, async () => {
        if ((await store.historyEpoch(id)) !== expectedEpoch) return false;
        await store.reset(id, epoch);
        if (incoming.length > 0) await store.append(id, incoming);
        return true;
      }),
    async load(conversationId) {
      await pending.get(conversationId);
      return store.load(conversationId);
    },

    commit(conversationId, incoming, epoch) {
      return exclusive(conversationId, async () => {
        if (epoch !== undefined) {
          const current = await store.historyEpoch(conversationId);
          // Once an epoch is known, only explicit invalidation or guarded
          // full-history replacement may change it (in either direction).
          if (current !== undefined && current !== epoch) return store.load(conversationId);
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
