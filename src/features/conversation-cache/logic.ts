import type { StoredChunk } from "@dispatch/wire";
import type { ConversationCacheIndexEntry, ReconcileResult } from "./types";

/**
 * Merge authoritative seq-keyed chunks with cached chunks.
 *
 * Deduplicates by `seq`, produces seq-monotonic order.
 * `toAppend` = the incoming chunks whose `seq` is not already in `cached`,
 * plus cached rows UPGRADED with a `turnId` the incoming copy carries and the
 * cached copy lacks (exactly what to persist — the store upserts by seq). Idempotent; tolerant of out-of-order/overlapping `incoming`.
 */
export function reconcileCache(
  cached: readonly StoredChunk[],
  incoming: readonly StoredChunk[],
): ReconcileResult {
  const bySeq = new Map<number, StoredChunk>();
  for (const chunk of cached) {
    bySeq.set(chunk.seq, chunk);
  }

  const toAppend: StoredChunk[] = [];
  for (const chunk of incoming) {
    const have = bySeq.get(chunk.seq);
    if (have === undefined) {
      toAppend.push(chunk);
      bySeq.set(chunk.seq, chunk);
    } else if (have.turnId === undefined && chunk.turnId !== undefined) {
      // Upgrade a cached row written before the server stamped `turnId`
      // (seqs are immutable, so only this provenance field can differ).
      const upgraded = { ...have, turnId: chunk.turnId };
      toAppend.push(upgraded);
      bySeq.set(chunk.seq, upgraded);
    }
  }

  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return { merged, toAppend };
}

/**
 * Return the max committed `seq`, or `0` if empty.
 * This is the `?sinceSeq=` cursor for the next incremental sync.
 */
export function nextSinceSeq(cached: readonly StoredChunk[]): number {
  if (cached.length === 0) return 0;
  let max = 0;
  for (const chunk of cached) {
    if (chunk.seq > max) max = chunk.seq;
  }
  return max;
}

/**
 * Choose conversationIds to evict to get total cached chunks under `maxChunks`.
 *
 * LRU eviction: oldest `lastAccess` first, tie-break smaller `maxSeq`.
 * NEVER evicts the `activeConversationId`.
 * Returns [] when under budget.
 */
export function selectEvictions(
  index: readonly ConversationCacheIndexEntry[],
  opts: { maxChunks: number; activeConversationId: string | null },
): readonly string[] {
  const totalChunks = index.reduce((sum, entry) => sum + entry.chunkCount, 0);
  if (totalChunks <= opts.maxChunks) return [];

  const candidates = index
    .filter((entry) => entry.conversationId !== opts.activeConversationId)
    .sort((a, b) => {
      const aAccess = a.lastAccess ?? 0;
      const bAccess = b.lastAccess ?? 0;
      if (aAccess !== bAccess) return aAccess - bAccess;
      return a.maxSeq - b.maxSeq;
    });

  let remaining = totalChunks;
  const evictions: string[] = [];
  for (const entry of candidates) {
    if (remaining <= opts.maxChunks) break;
    evictions.push(entry.conversationId);
    remaining -= entry.chunkCount;
  }

  return evictions;
}
