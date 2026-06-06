import type { AgentEvent, StoredChunk } from "@dispatch/wire";
import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "./store.svelte";
import { createFakeCache, createFakeHistorySync, createFakeTransport } from "./test-helpers";

const CONV_ID = "test-conv-1";

function makeStoredChunk(seq: number, role: "user" | "assistant" = "assistant"): StoredChunk {
	return { seq, role, chunk: { type: "text", text: `chunk-${seq}` } };
}

function deltaEvent(event: AgentEvent): import("@dispatch/transport-contract").ChatDeltaMessage {
	return { type: "chat.delta", event };
}

function errorMessage(message: string): import("@dispatch/transport-contract").ChatErrorMessage {
	return { type: "chat.error", message };
}

describe("createChatStore", () => {
	it("folding a chat.delta updates messages", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({ type: "text-delta", conversationId: CONV_ID, turnId: "t1", delta: "Hello" }),
		);
		store.handleDelta(
			deltaEvent({ type: "text-delta", conversationId: CONV_ID, turnId: "t1", delta: " world" }),
		);

		expect(store.messages).toHaveLength(1);
		expect(store.messages[0]?.role).toBe("assistant");
		expect(store.messages[0]?.chunks).toHaveLength(1);
		expect(store.messages[0]?.chunks[0]?.type).toBe("text");
		expect((store.messages[0]?.chunks[0] as { type: "text"; text: string }).text).toBe(
			"Hello world",
		);

		store.dispose();
	});

	it("turn-sealed triggers a history sync, commits to cache, and applies merged history", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		// Set up what the history sync will return
		historySync.returnChunks = [makeStoredChunk(1), makeStoredChunk(2)];

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({ type: "text-delta", conversationId: CONV_ID, turnId: "t1", delta: "Hi" }),
		);
		store.handleDelta(
			deltaEvent({ type: "done", conversationId: CONV_ID, turnId: "t1", reason: "end-turn" }),
		);
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		// Wait for the async sync to complete
		await vi.waitFor(() => {
			expect(historySync.calls).toHaveLength(1);
		});

		expect(historySync.calls[0]?.conversationId).toBe(CONV_ID);
		expect(historySync.calls[0]?.sinceSeq).toBe(0);

		// Cache should have the committed chunks
		const cached = await cache.impl.load(CONV_ID);
		expect(cached).toHaveLength(2);

		// Messages should include both provisional and committed
		expect(store.messages.length).toBeGreaterThanOrEqual(1);

		store.dispose();
	});

	it("send posts a chat.send with conversationId", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.send("Hello server");

		expect(transport.sent).toHaveLength(1);
		expect(transport.sent[0]?.type).toBe("chat.send");
		expect(transport.sent[0]?.conversationId).toBe(CONV_ID);
		expect(transport.sent[0]?.message).toBe("Hello server");
		expect(transport.sent[0]).not.toHaveProperty("model");

		store.dispose();
	});

	it("send posts a chat.send with model when set", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			model: "openai/gpt-4",
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.send("Hello");

		expect(transport.sent).toHaveLength(1);
		expect(transport.sent[0]?.model).toBe("openai/gpt-4");

		store.dispose();
	});

	it("chat.error sets error", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		expect(store.error).toBeNull();

		store.handleDelta(errorMessage("Something broke"));

		expect(store.error).toBe("Something broke");

		store.dispose();
	});

	it("load hydrates from cache then syncs the tail", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();

		// Pre-populate cache
		await cache.impl.commit(CONV_ID, [makeStoredChunk(1, "user"), makeStoredChunk(2, "assistant")]);

		// History sync returns new chunks
		historySync.returnChunks = [makeStoredChunk(3, "assistant")];

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		await store.load();

		// Should have synced
		expect(historySync.calls).toHaveLength(1);
		expect(historySync.calls[0]?.sinceSeq).toBe(2);

		// Messages should include all chunks
		expect(store.messages.length).toBeGreaterThanOrEqual(2);

		store.dispose();
	});

	it("load with empty cache still syncs", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();

		historySync.returnChunks = [makeStoredChunk(1, "assistant")];

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		await store.load();

		expect(historySync.calls).toHaveLength(1);
		expect(historySync.calls[0]?.sinceSeq).toBe(0);

		store.dispose();
	});

	it("error is cleared on successful sync", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		// First, set an error
		store.handleDelta(errorMessage("fail"));
		expect(store.error).toBe("fail");

		// Now trigger a successful sync via turn-sealed
		historySync.returnChunks = [makeStoredChunk(1)];
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({ type: "done", conversationId: CONV_ID, turnId: "t1", reason: "end-turn" }),
		);
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		await vi.waitFor(() => {
			expect(store.error).toBeNull();
		});

		store.dispose();
	});

	it("dispose prevents further syncs", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.dispose();

		// Trigger a turn-sealed after dispose
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		// Wait a tick to let any async work settle
		await new Promise((r) => setTimeout(r, 10));

		// No sync should have happened
		expect(historySync.calls).toHaveLength(0);

		store.dispose();
	});

	it("overlapping syncs are guarded", async () => {
		const transport = createFakeTransport();
		const _historySync = createFakeHistorySync();
		const cache = createFakeCache();

		// Make the first sync slow
		let resolveFirstSync: (() => void) | undefined;
		const firstSyncPromise = new Promise<void>((resolve) => {
			resolveFirstSync = resolve;
		});

		let callCount = 0;
		const slowHistorySync: import("./ports").HistorySync = async (_conversationId, sinceSeq) => {
			callCount++;
			if (callCount === 1) {
				await firstSyncPromise;
			}
			return { chunks: [], latestSeq: sinceSeq };
		};

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: slowHistorySync,
			cache: cache.impl,
		});

		// Trigger first sync
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		// Wait a tick so the first sync starts
		await new Promise((r) => setTimeout(r, 0));

		// Trigger second sync while first is pending
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t2" }));
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t2" }));

		// Only one call should have been made (second was guarded)
		expect(callCount).toBe(1);

		// Release the first sync
		resolveFirstSync?.();
		await new Promise((r) => setTimeout(r, 10));

		store.dispose();
	});

	it("handles tool-call and tool-result chunks", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({
				type: "tool-call",
				conversationId: CONV_ID,
				turnId: "t1",
				toolCallId: "tc1",
				toolName: "read_file",
				input: { path: "/tmp/test.txt" },
			}),
		);
		store.handleDelta(
			deltaEvent({
				type: "tool-result",
				conversationId: CONV_ID,
				turnId: "t1",
				toolCallId: "tc1",
				toolName: "read_file",
				content: "file contents",
				isError: false,
			}),
		);

		expect(store.chunks).toHaveLength(2);
		expect(store.chunks[0]?.chunk.type).toBe("tool-call");
		expect(store.chunks[1]?.chunk.type).toBe("tool-result");

		store.dispose();
	});

	it("setModel changes the model used by the next send", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			model: "openai/gpt-4",
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.send("First");
		expect(transport.sent[0]?.model).toBe("openai/gpt-4");

		store.setModel("anthropic/claude-3");
		store.send("Second");
		expect(transport.sent[1]?.model).toBe("anthropic/claude-3");

		store.dispose();
	});

	it("setModel from undefined to a model", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.send("First");
		expect(transport.sent[0]).not.toHaveProperty("model");

		store.setModel("openai/gpt-4o");
		store.send("Second");
		expect(transport.sent[1]?.model).toBe("openai/gpt-4o");

		store.dispose();
	});

	it("handleDelta ignores a chat.delta for a different conversationId", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.handleDelta(
			deltaEvent({ type: "turn-start", conversationId: "other-conv", turnId: "t1" }),
		);
		store.handleDelta(
			deltaEvent({
				type: "text-delta",
				conversationId: "other-conv",
				turnId: "t1",
				delta: "Should be ignored",
			}),
		);

		expect(store.messages).toHaveLength(0);

		store.dispose();
	});

	it("handleDelta ignores a chat.error for a different conversationId", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			cache: cache.impl,
		});

		store.handleDelta({ type: "chat.error", conversationId: "other-conv", message: "Wrong conv" });

		expect(store.error).toBeNull();

		store.dispose();
	});
});
