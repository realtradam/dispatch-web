import type { StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { createConversationCache } from "./cache";
import type { ConversationCacheIndexEntry, ConversationChunkStore } from "./types";

const chunk = (seq: number, role: "user" | "assistant" = "user"): StoredChunk => ({
  seq,
  role,
  chunk: { type: "text", text: `chunk-${seq}` },
});

/**
 * In-memory fake ConversationChunkStore — the ONLY allowed fake.
 * An outermost edge: simulates the storage port without any real I/O.
 */
function createFakeStore(): ConversationChunkStore {
  const store = new Map<string, StoredChunk[]>();
  const epochs = new Map<string, number>();

  return {
    async historyEpoch(id) {
      return epochs.get(id);
    },
    async reset(id, epoch) {
      store.delete(id);
      epochs.set(id, epoch);
    },
    async load(conversationId) {
      return store.get(conversationId) ?? [];
    },

    async append(conversationId, chunks) {
      const existing = store.get(conversationId) ?? [];
      const existingSeqs = new Set(existing.map((c) => c.seq));
      const toAdd = chunks.filter((c) => !existingSeqs.has(c.seq));
      store.set(
        conversationId,
        [...existing, ...toAdd].sort((a, b) => a.seq - b.seq),
      );
    },

    async delete(conversationId) {
      store.delete(conversationId);
      epochs.delete(conversationId);
    },

    async index() {
      const entries: ConversationCacheIndexEntry[] = [];
      for (const [id, chunks] of store) {
        if (chunks.length === 0) continue;
        let maxSeq = 0;
        for (const c of chunks) {
          if (c.seq > maxSeq) maxSeq = c.seq;
        }
        entries.push({
          conversationId: id,
          chunkCount: chunks.length,
          maxSeq,
        });
      }
      return entries;
    },
  };
}

describe("cache.load", () => {
  it("returns stored chunks", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);
    await store.append("conv-1", [chunk(1), chunk(2)]);
    const result = await cache.load("conv-1");
    expect(result).toEqual([chunk(1), chunk(2)]);
  });

  it("returns empty array for absent conversation", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);
    const result = await cache.load("nonexistent");
    expect(result).toEqual([]);
  });
});

describe("cache.commit", () => {
  it("appends only new chunks", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);
    await store.append("conv-1", [chunk(1), chunk(2)]);

    const merged = await cache.commit("conv-1", [chunk(2), chunk(3)]);
    expect(merged).toEqual([chunk(1), chunk(2), chunk(3)]);

    // Verify store has all chunks
    const stored = await store.load("conv-1");
    expect(stored).toEqual([chunk(1), chunk(2), chunk(3)]);
  });

  it("returns full merged result", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);

    const merged = await cache.commit("conv-1", [chunk(3), chunk(1)]);
    expect(merged).toEqual([chunk(1), chunk(3)]);
  });

  it("is idempotent — re-committing same chunks is a no-op", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);

    await cache.commit("conv-1", [chunk(1), chunk(2)]);
    const merged = await cache.commit("conv-1", [chunk(1), chunk(2)]);
    expect(merged).toEqual([chunk(1), chunk(2)]);

    const stored = await store.load("conv-1");
    expect(stored).toEqual([chunk(1), chunk(2)]);
  });
});

describe("cache.sinceSeq", () => {
  it("returns max seq from cache", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);
    await store.append("conv-1", [chunk(1), chunk(5), chunk(3)]);
    expect(await cache.sinceSeq("conv-1")).toBe(5);
  });

  it("returns 0 for empty conversation", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);
    expect(await cache.sinceSeq("conv-1")).toBe(0);
  });
});

describe("cache.evictIfOverBudget", () => {
  it("deletes selected conversations", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store, { maxChunks: 5 });

    await store.append("a", [chunk(1), chunk(2)]);
    await store.append("b", [chunk(1), chunk(2)]);
    await store.append("c", [chunk(1)]);

    // Total = 5, max = 5, under budget
    const evicted = await cache.evictIfOverBudget(null);
    expect(evicted).toEqual([]);

    // Add more to go over budget
    await store.append("d", [chunk(1), chunk(2), chunk(3)]);
    // Total = 8, max = 5, need to evict 3+ chunks

    const evicted2 = await cache.evictIfOverBudget(null);
    expect(evicted2.length).toBeGreaterThan(0);

    // Verify evicted conversations are deleted
    for (const id of evicted2) {
      expect(await store.load(id)).toEqual([]);
    }
  });

  it("never evicts the active conversation", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store, { maxChunks: 3 });

    await store.append("active", [chunk(1), chunk(2), chunk(3)]);
    await store.append("other", [chunk(1), chunk(2)]);

    // Total = 5, max = 3, need to evict 2+ chunks
    const evicted = await cache.evictIfOverBudget("active");
    expect(evicted).not.toContain("active");
    expect(evicted).toContain("other");
  });

  it("returns empty when under budget", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store, { maxChunks: 100 });

    await store.append("a", [chunk(1)]);
    await store.append("b", [chunk(1)]);

    const evicted = await cache.evictIfOverBudget(null);
    expect(evicted).toEqual([]);
  });
});

describe("cache.delete", () => {
  it("removes the conversation from the store", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);

    await store.append("conv-1", [chunk(1), chunk(2)]);
    await cache.delete("conv-1");

    const stored = await store.load("conv-1");
    expect(stored).toEqual([]);
  });

  it("then load returns []", async () => {
    const store = createFakeStore();
    const cache = createConversationCache(store);

    await cache.commit("conv-1", [chunk(1), chunk(2), chunk(3)]);
    await cache.delete("conv-1");

    const result = await cache.load("conv-1");
    expect(result).toEqual([]);
  });
});

it("serializes invalidation and rejects stale epoch commits", async () => {
  const store = createFakeStore();
  const cache = createConversationCache(store);
  await store.append("c", [chunk(1)]); // Legacy rows have no trusted epoch.
  expect(await cache.commit("c", [chunk(101)], 1)).toEqual([chunk(101)]);
  await Promise.all([cache.commit("c", [chunk(102)], 1), cache.reset("c", 2)]);
  expect(await cache.commit("c", [chunk(103)], 1)).toEqual([]);
  expect(await store.historyEpoch("c")).toBe(2);
});

it("replaces a confirmed full history at a lower epoch, without trusting stale commits", async () => {
  const store = createFakeStore();
  const cache = createConversationCache(store);
  await cache.commit("c", [chunk(9)], 5);
  expect(await cache.replace("c", [chunk(1)], 1, 5)).toBe(true);
  expect(await cache.historyEpoch("c")).toBe(1);
  expect(await cache.load("c")).toEqual([chunk(1)]);
  expect(await cache.commit("c", [chunk(9)], 5)).toEqual([chunk(1)]);
  // A delayed full response started against epoch 5 must not restore it.
  expect(await cache.replace("c", [chunk(9)], 5, 5)).toBe(false);
  expect(await cache.load("c")).toEqual([chunk(1)]);
});

it("serializes a guarded replacement behind newer invalidation", async () => {
  const store = createFakeStore();
  const cache = createConversationCache(store);
  await cache.commit("c", [chunk(9)], 5);
  const resetting = cache.reset("c", 6);
  const replacing = cache.replace("c", [chunk(1)], 1, 5);
  await resetting;
  expect(await replacing).toBe(false);
  expect(await cache.historyEpoch("c")).toBe(6);
  expect(await cache.load("c")).toEqual([]);
});

it("allows an empty replacement and a legacy cache only if its observed epoch still matches", async () => {
  const store = createFakeStore();
  const cache = createConversationCache(store);
  await store.append("c", [chunk(9)]);
  expect(await cache.replace("c", [], 0, undefined)).toBe(true);
  expect(await cache.sinceSeq("c")).toBe(0);
  expect(await cache.historyEpoch("c")).toBe(0);
  expect(await cache.replace("c", [chunk(9)], 2, undefined)).toBe(false);
});
