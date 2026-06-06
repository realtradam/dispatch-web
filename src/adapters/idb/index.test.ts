import "fake-indexeddb/auto";
import type { StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { createIdbChunkStore } from "./index";

function textChunk(text: string): StoredChunk["chunk"] {
	return { type: "text", text };
}

function makeChunk(
	seq: number,
	text: string,
	role: StoredChunk["role"] = "assistant",
): StoredChunk {
	return { seq, role, chunk: textChunk(text) };
}

describe("createIdbChunkStore", () => {
	it("append then load returns chunks seq-ordered", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });
		const chunks = [makeChunk(1, "a"), makeChunk(2, "b"), makeChunk(3, "c")];

		await store.append("conv1", chunks);
		const loaded = await store.load("conv1");

		expect(loaded).toHaveLength(3);
		expect(loaded[0]?.seq).toBe(1);
		expect(loaded[1]?.seq).toBe(2);
		expect(loaded[2]?.seq).toBe(3);
		expect(loaded[0]?.chunk).toEqual(textChunk("a"));
	});

	it("append out-of-order still loads seq-ordered", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });
		const chunks = [makeChunk(3, "c"), makeChunk(1, "a"), makeChunk(2, "b")];

		await store.append("conv1", chunks);
		const loaded = await store.load("conv1");

		expect(loaded).toHaveLength(3);
		expect(loaded.map((c) => c.seq)).toEqual([1, 2, 3]);
	});

	it("append is idempotent on duplicate seq", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });

		await store.append("conv1", [makeChunk(1, "first"), makeChunk(2, "b")]);
		await store.append("conv1", [makeChunk(1, "first"), makeChunk(3, "c")]);

		const loaded = await store.load("conv1");
		expect(loaded).toHaveLength(3);
		expect(loaded.map((c) => c.seq)).toEqual([1, 2, 3]);
		expect(loaded[0]?.chunk).toEqual(textChunk("first"));
	});

	it("load returns [] for an absent conversation", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });

		const loaded = await store.load("nonexistent");
		expect(loaded).toEqual([]);
	});

	it("delete removes a conversation", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });

		await store.append("conv1", [makeChunk(1, "a")]);
		await store.append("conv2", [makeChunk(1, "b")]);

		await store.delete("conv1");

		expect(await store.load("conv1")).toEqual([]);
		const conv2 = await store.load("conv2");
		expect(conv2).toHaveLength(1);
		expect(conv2[0]?.chunk).toEqual(textChunk("b"));
	});

	it("index aggregates chunkCount and maxSeq", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });

		await store.append("conv1", [makeChunk(1, "a"), makeChunk(2, "b"), makeChunk(3, "c")]);
		await store.append("conv2", [makeChunk(1, "x")]);

		const idx = await store.index();
		expect(idx).toHaveLength(2);

		const c1 = idx.find((e) => e.conversationId === "conv1");
		const c2 = idx.find((e) => e.conversationId === "conv2");

		expect(c1?.chunkCount).toBe(3);
		expect(c1?.maxSeq).toBe(3);
		expect(c2?.chunkCount).toBe(1);
		expect(c2?.maxSeq).toBe(1);
	});

	it("index reports lastAccess after load", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });

		await store.append("conv1", [makeChunk(1, "a")]);
		const idx = await store.index();

		const entry = idx.find((e) => e.conversationId === "conv1");
		expect(entry?.lastAccess).toBeTypeOf("number");
		expect(entry?.lastAccess).toBeGreaterThan(0);
	});

	it("separate conversations are isolated", async () => {
		const store = createIdbChunkStore({ indexedDB: new IDBFactory() });

		await store.append("conv1", [makeChunk(1, "a1"), makeChunk(2, "a2")]);
		await store.append("conv2", [makeChunk(1, "b1")]);

		const loaded1 = await store.load("conv1");
		const loaded2 = await store.load("conv2");

		expect(loaded1).toHaveLength(2);
		expect(loaded2).toHaveLength(1);
		expect(loaded1[0]?.chunk).toEqual(textChunk("a1"));
		expect(loaded2[0]?.chunk).toEqual(textChunk("b1"));
	});
});
