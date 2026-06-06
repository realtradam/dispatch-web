import type { StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { nextSinceSeq, reconcileCache, selectEvictions } from "./logic";
import type { ConversationCacheIndexEntry } from "./types";

const chunk = (seq: number, role: "user" | "assistant" = "user"): StoredChunk => ({
	seq,
	role,
	chunk: { type: "text", text: `chunk-${seq}` },
});

describe("reconcileCache", () => {
	it("merges and dedupes by seq", () => {
		const cached = [chunk(1), chunk(2)];
		const incoming = [chunk(2), chunk(3)];
		const result = reconcileCache(cached, incoming);
		expect(result.merged).toEqual([chunk(1), chunk(2), chunk(3)]);
	});

	it("toAppend excludes already-cached seqs", () => {
		const cached = [chunk(1), chunk(2)];
		const incoming = [chunk(2), chunk(3)];
		const result = reconcileCache(cached, incoming);
		expect(result.toAppend).toEqual([chunk(3)]);
	});

	it("tolerates out-of-order incoming", () => {
		const cached = [chunk(1)];
		const incoming = [chunk(5), chunk(3), chunk(2)];
		const result = reconcileCache(cached, incoming);
		expect(result.merged).toEqual([chunk(1), chunk(2), chunk(3), chunk(5)]);
		expect(result.toAppend).toEqual([chunk(5), chunk(3), chunk(2)]);
	});

	it("returns empty merged and toAppend when both inputs are empty", () => {
		const result = reconcileCache([], []);
		expect(result.merged).toEqual([]);
		expect(result.toAppend).toEqual([]);
	});

	it("handles empty cached with incoming", () => {
		const incoming = [chunk(3), chunk(1)];
		const result = reconcileCache([], incoming);
		expect(result.merged).toEqual([chunk(1), chunk(3)]);
		expect(result.toAppend).toEqual([chunk(3), chunk(1)]);
	});

	it("handles cached with empty incoming", () => {
		const cached = [chunk(1), chunk(2)];
		const result = reconcileCache(cached, []);
		expect(result.merged).toEqual([chunk(1), chunk(2)]);
		expect(result.toAppend).toEqual([]);
	});

	it("is idempotent — re-reconciling same incoming produces same result", () => {
		const cached = [chunk(1)];
		const incoming = [chunk(2), chunk(3)];
		const first = reconcileCache(cached, incoming);
		const second = reconcileCache(first.merged, incoming);
		expect(second.merged).toEqual(first.merged);
		expect(second.toAppend).toEqual([]);
	});
});

describe("nextSinceSeq", () => {
	it("returns max seq", () => {
		const cached = [chunk(1), chunk(5), chunk(3)];
		expect(nextSinceSeq(cached)).toBe(5);
	});

	it("returns 0 when empty", () => {
		expect(nextSinceSeq([])).toBe(0);
	});

	it("returns single seq for single chunk", () => {
		expect(nextSinceSeq([chunk(42)])).toBe(42);
	});
});

describe("selectEvictions", () => {
	it("never evicts the active conversation", () => {
		const index: ConversationCacheIndexEntry[] = [
			{ conversationId: "active", chunkCount: 100, maxSeq: 100, lastAccess: 1000 },
			{ conversationId: "other", chunkCount: 50, maxSeq: 50, lastAccess: 1 },
		];
		const result = selectEvictions(index, { maxChunks: 50, activeConversationId: "active" });
		expect(result).not.toContain("active");
		expect(result).toContain("other");
	});

	it("evicts LRU until under budget", () => {
		const index: ConversationCacheIndexEntry[] = [
			{ conversationId: "a", chunkCount: 30, maxSeq: 30, lastAccess: 100 },
			{ conversationId: "b", chunkCount: 30, maxSeq: 30, lastAccess: 50 },
			{ conversationId: "c", chunkCount: 30, maxSeq: 30, lastAccess: 200 },
			{ conversationId: "d", chunkCount: 30, maxSeq: 30, lastAccess: 10 },
		];
		// Total = 120, max = 60, need to evict 60+ chunks
		// LRU order: d(10), b(50), a(100), c(200)
		const result = selectEvictions(index, { maxChunks: 60, activeConversationId: null });
		expect(result).toEqual(["d", "b"]);
	});

	it("is a no-op under budget", () => {
		const index: ConversationCacheIndexEntry[] = [
			{ conversationId: "a", chunkCount: 10, maxSeq: 10, lastAccess: 100 },
			{ conversationId: "b", chunkCount: 10, maxSeq: 10, lastAccess: 50 },
		];
		const result = selectEvictions(index, { maxChunks: 100, activeConversationId: null });
		expect(result).toEqual([]);
	});

	it("returns empty for empty index", () => {
		const result = selectEvictions([], { maxChunks: 100, activeConversationId: null });
		expect(result).toEqual([]);
	});

	it("tie-breaks by smaller maxSeq when lastAccess is equal", () => {
		const index: ConversationCacheIndexEntry[] = [
			{ conversationId: "a", chunkCount: 30, maxSeq: 100, lastAccess: 50 },
			{ conversationId: "b", chunkCount: 30, maxSeq: 50, lastAccess: 50 },
			{ conversationId: "c", chunkCount: 30, maxSeq: 200, lastAccess: 50 },
		];
		// Total = 90, max = 60, need to evict 30+ chunks
		// All have same lastAccess, tie-break by maxSeq: b(50), a(100), c(200)
		const result = selectEvictions(index, { maxChunks: 60, activeConversationId: null });
		expect(result).toEqual(["b"]);
	});

	it("handles missing lastAccess (treated as 0)", () => {
		const index: ConversationCacheIndexEntry[] = [
			{ conversationId: "a", chunkCount: 30, maxSeq: 30, lastAccess: 100 },
			{ conversationId: "b", chunkCount: 30, maxSeq: 30 },
		];
		// Total = 60, max = 30, need to evict 30+ chunks
		// b has no lastAccess (0), a has 100
		const result = selectEvictions(index, { maxChunks: 30, activeConversationId: null });
		expect(result).toEqual(["b"]);
	});
});
