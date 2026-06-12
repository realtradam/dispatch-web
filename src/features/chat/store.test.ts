import type { AgentEvent, StepId, StoredChunk } from "@dispatch/wire";
import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "./store.svelte";
import {
	createFakeCache,
	createFakeHistorySync,
	createFakeMetricsSync,
	createFakeTransport,
} from "./test-helpers";

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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			model: "openai/gpt-4",
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();

		// Pre-populate cache
		await cache.impl.commit(CONV_ID, [makeStoredChunk(1, "user"), makeStoredChunk(2, "assistant")]);

		// History sync returns new chunks
		historySync.returnChunks = [makeStoredChunk(3, "assistant")];

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();

		historySync.returnChunks = [makeStoredChunk(1, "assistant")];

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
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
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
				stepId: "t1#0" as StepId,
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
				stepId: "t1#0" as StepId,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			model: "openai/gpt-4",
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
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
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		store.handleDelta({ type: "chat.error", conversationId: "other-conv", message: "Wrong conv" });

		expect(store.error).toBeNull();

		store.dispose();
	});

	it("send optimistically shows the user message immediately", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		store.send("hi");

		expect(store.messages).toHaveLength(1);
		expect(store.messages[0]?.role).toBe("user");
		expect(store.messages[0]?.chunks).toHaveLength(1);
		expect(store.messages[0]?.chunks[0]?.type).toBe("text");
		expect((store.messages[0]?.chunks[0] as { type: "text"; text: string }).text).toBe("hi");

		store.dispose();
	});

	it("the optimistic user message is replaced after turn-sealed + history sync", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		historySync.returnChunks = [
			{ seq: 1, role: "user", chunk: { type: "text", text: "hi" } },
			{ seq: 2, role: "assistant", chunk: { type: "text", text: "hello!" } },
		];

		store.send("hi");
		expect(store.messages).toHaveLength(1);
		expect(store.messages[0]?.role).toBe("user");

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({ type: "text-delta", conversationId: CONV_ID, turnId: "t1", delta: "hello!" }),
		);
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		await vi.waitFor(() => {
			expect(store.messages.length).toBe(2);
		});

		expect(store.messages[0]?.role).toBe("user");
		expect(store.messages[1]?.role).toBe("assistant");

		store.dispose();
	});

	it("folding usage/step-complete/done deltas exposes turnMetrics", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		expect(store.turnMetrics).toHaveLength(0);

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({
				type: "usage",
				conversationId: CONV_ID,
				turnId: "t1",
				stepId: "t1#0" as StepId,
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);
		store.handleDelta(
			deltaEvent({
				type: "step-complete",
				conversationId: CONV_ID,
				turnId: "t1",
				stepId: "t1#0" as StepId,
				ttftMs: 200,
				genTotalMs: 800,
			}),
		);
		store.handleDelta(
			deltaEvent({
				type: "done",
				conversationId: CONV_ID,
				turnId: "t1",
				reason: "end-turn",
				durationMs: 1200,
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);

		expect(store.turnMetrics).toHaveLength(1);
		const entry = store.turnMetrics[0];
		expect(entry?.turnId).toBe("t1");
		expect(entry?.steps).toHaveLength(1);
		expect(entry?.steps[0]?.stepId).toBe("t1#0" as StepId);
		expect(entry?.steps[0]?.usage.inputTokens).toBe(100);
		expect(entry?.steps[0]?.genTotalMs).toBe(800);
		expect(entry?.total).not.toBeNull();
		expect(entry?.total?.usage.inputTokens).toBe(100);
		expect(entry?.total?.usage.outputTokens).toBe(50);
		expect(entry?.total?.durationMs).toBe(1200);

		store.dispose();
	});

	it("turnMetrics entry has total: null before done (progressive turn)", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({
				type: "usage",
				conversationId: CONV_ID,
				turnId: "t1",
				stepId: "t1#0" as StepId,
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);
		store.handleDelta(
			deltaEvent({
				type: "step-complete",
				conversationId: CONV_ID,
				turnId: "t1",
				stepId: "t1#0" as StepId,
				ttftMs: 200,
				genTotalMs: 800,
			}),
		);

		expect(store.turnMetrics).toHaveLength(1);
		const entry = store.turnMetrics[0];
		expect(entry?.turnId).toBe("t1");
		expect(entry?.steps).toHaveLength(1);
		expect(entry?.steps[0]?.stepId).toBe("t1#0" as StepId);
		expect(entry?.total).toBeNull();

		store.dispose();
	});

	it("metricsSync durable result overrides live by turnId", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		// Live fold gives some metrics
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({
				type: "usage",
				conversationId: CONV_ID,
				turnId: "t1",
				stepId: "t1#0" as StepId,
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);
		store.handleDelta(
			deltaEvent({
				type: "done",
				conversationId: CONV_ID,
				turnId: "t1",
				reason: "end-turn",
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);

		expect(store.turnMetrics).toHaveLength(1);
		expect(store.turnMetrics[0]?.total?.usage.outputTokens).toBe(50);

		// Durable sync returns different numbers for the same turnId
		metricsSync.returnTurns = [
			{
				turnId: "t1",
				usage: { inputTokens: 200, outputTokens: 80 },
				durationMs: 500,
				steps: [
					{
						stepId: "t1#0" as StepId,
						usage: { inputTokens: 200, outputTokens: 80 },
						genTotalMs: 400,
					},
				],
			},
		];

		// Trigger metrics sync via turn-sealed
		historySync.returnChunks = [];
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		await vi.waitFor(() => {
			expect(metricsSync.calls).toHaveLength(1);
		});

		// Durable should now override live (syncMetrics is async, wait for it)
		await vi.waitFor(() => {
			expect(store.turnMetrics[0]?.total?.usage.outputTokens).toBe(80);
		});

		expect(store.turnMetrics).toHaveLength(1);
		expect(store.turnMetrics[0]?.total?.durationMs).toBe(500);

		store.dispose();
	});

	it("rejected metricsSync leaves live metrics intact and does not throw", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		// Live fold some metrics
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({
				type: "usage",
				conversationId: CONV_ID,
				turnId: "t1",
				stepId: "t1#0" as StepId,
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);
		store.handleDelta(
			deltaEvent({
				type: "done",
				conversationId: CONV_ID,
				turnId: "t1",
				reason: "end-turn",
				usage: { inputTokens: 100, outputTokens: 50 },
			}),
		);

		expect(store.turnMetrics).toHaveLength(1);

		// Make the metrics sync reject
		metricsSync.nextError = "metrics endpoint unavailable";

		historySync.returnChunks = [];
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));

		await vi.waitFor(() => {
			expect(metricsSync.calls).toHaveLength(1);
		});

		// Live metrics should still be intact
		expect(store.turnMetrics).toHaveLength(1);
		expect(store.turnMetrics[0]?.total?.usage.outputTokens).toBe(50);

		// No error should have been thrown to the store
		expect(store.error).toBeNull();

		store.dispose();
	});

	it("load calls metricsSync after history sync", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();

		metricsSync.returnTurns = [
			{
				turnId: "t1",
				usage: { inputTokens: 300, outputTokens: 100 },
				durationMs: 900,
				steps: [],
			},
		];

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		await store.load();

		expect(historySync.calls).toHaveLength(1);
		expect(metricsSync.calls).toHaveLength(1);
		expect(metricsSync.calls[0]).toBe(CONV_ID);
		expect(store.turnMetrics).toHaveLength(1);
		expect(store.turnMetrics[0]?.total?.usage.inputTokens).toBe(300);

		store.dispose();
	});

	it("generating reflects the turn lifecycle (idle → running → idle)", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		expect(store.generating).toBe(false);

		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		expect(store.generating).toBe(true);

		store.handleDelta(
			deltaEvent({ type: "text-delta", conversationId: CONV_ID, turnId: "t1", delta: "hi" }),
		);
		expect(store.generating).toBe(true);

		store.handleDelta(
			deltaEvent({ type: "done", conversationId: CONV_ID, turnId: "t1", reason: "end-turn" }),
		);
		expect(store.generating).toBe(false);

		store.dispose();
	});

	it("generating lights up for a watcher whose turn was replayed (no send first)", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		// A late-joiner receives the in-flight turn replayed from turn-start.
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(
			deltaEvent({ type: "text-delta", conversationId: CONV_ID, turnId: "t1", delta: "partial" }),
		);
		expect(store.generating).toBe(true);
		expect(transport.sent).toHaveLength(0); // it never sent — it's just watching

		store.dispose();
	});

	it("resync clears a stale generating flag and re-syncs history + metrics", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		// Disconnected mid-turn: turn-start seen, but the live done/turn-sealed was
		// missed, so generating is stuck true.
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		expect(store.generating).toBe(true);

		// The turn actually sealed while we were gone — history now has the chunks.
		historySync.returnChunks = [makeStoredChunk(1), makeStoredChunk(2)];

		store.resync();

		// Generating is cleared synchronously (a finished turn must not spin forever).
		expect(store.generating).toBe(false);

		await vi.waitFor(() => {
			expect(historySync.calls).toHaveLength(1);
			expect(metricsSync.calls).toHaveLength(1);
		});

		store.dispose();
	});

	it("chat limit: crossing the limit unloads the oldest quarter in one bulk pass", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
		});

		// Commit exactly 100 chunks via a sealed turn (at the limit — no trim).
		const hundred = Array.from({ length: 100 }, (_, i) => makeStoredChunk(i + 1));
		historySync.returnChunks = hundred;
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));
		await vi.waitFor(() => {
			expect(store.chunks).toHaveLength(100);
		});
		expect(store.hasEarlier).toBe(false);

		// The 101st chunk (a live tool-call) crosses the limit → 25 unload → 76 remain.
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t2" }));
		store.handleDelta(
			deltaEvent({
				type: "tool-call",
				conversationId: CONV_ID,
				turnId: "t2",
				toolCallId: "tc1",
				toolName: "probe",
				input: {},
				stepId: "t2#0" as StepId,
			}),
		);

		expect(store.chunks).toHaveLength(76);
		expect(store.chunks[0]?.seq).toBe(26);
		expect(store.hasEarlier).toBe(true);

		store.dispose();
	});

	it("chat limit: unloading is deferred while the gate is closed, then catches up", () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		let atBottom = false; // reader scrolled up
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 10,
			canUnload: () => atBottom,
		});

		// 15 live tool-calls: over the limit, but the gate defers every trim.
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		for (let i = 0; i < 15; i++) {
			store.handleDelta(
				deltaEvent({
					type: "tool-call",
					conversationId: CONV_ID,
					turnId: "t1",
					toolCallId: `tc${i}`,
					toolName: "probe",
					input: {},
					stepId: `t1#${i}` as StepId,
				}),
			);
		}
		expect(store.chunks).toHaveLength(15);

		// Reader returns to the bottom — but provisional chunks are never unloaded,
		// so the deferred trim still can't shrink an all-provisional transcript.
		atBottom = true;
		store.handleDelta(
			deltaEvent({
				type: "tool-call",
				conversationId: CONV_ID,
				turnId: "t1",
				toolCallId: "tc15",
				toolName: "probe",
				input: {},
				stepId: "t1#15" as StepId,
			}),
		);
		expect(store.chunks).toHaveLength(16);

		store.dispose();
	});

	it("chat limit: a deferred trim catches up across committed history once the gate opens", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		let atBottom = false;
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
			canUnload: () => atBottom,
		});

		// Seal a turn committing 130 chunks while the reader is scrolled up: no trim.
		historySync.returnChunks = Array.from({ length: 130 }, (_, i) => makeStoredChunk(i + 1));
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t1" }));
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t1" }));
		await vi.waitFor(() => {
			expect(store.chunks).toHaveLength(130);
		});

		// Back at the bottom: the next fold trims whole quarters down to ≤ 100.
		atBottom = true;
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t2" }));
		// 130 → 2 quarters of 25 → 80 committed (turn-start adds no chunk).
		expect(store.chunks).toHaveLength(80);
		expect(store.chunks[0]?.seq).toBe(51);

		store.dispose();
	});

	it("chat limit: load windows a long cached conversation to 75% of the limit", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		await cache.impl.commit(
			CONV_ID,
			Array.from({ length: 500 }, (_, i) => makeStoredChunk(i + 1)),
		);

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
		});

		await store.load();

		// floor(100 × 0.75) = 75 newest chunks: seqs 426..500.
		expect(store.chunks).toHaveLength(75);
		expect(store.chunks[0]?.seq).toBe(426);
		expect(store.hasEarlier).toBe(true);
		// The tail sync still used the cache's real cursor (not the window's edge).
		expect(historySync.calls[0]?.sinceSeq).toBe(500);

		store.dispose();
	});

	it("chat limit: a cold cache (fresh browser) windows the full server history to 75%", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		// Backend has no limit param yet (CR-5): sinceSeq=0 returns EVERYTHING.
		historySync.returnChunks = Array.from({ length: 500 }, (_, i) => makeStoredChunk(i + 1));

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
		});

		await store.load();

		expect(store.chunks).toHaveLength(75);
		expect(store.chunks[0]?.seq).toBe(426);
		expect(store.hasEarlier).toBe(true);
		// The full history is still CACHED locally (show-earlier pages from it).
		const cached = await cache.impl.load(CONV_ID);
		expect(cached).toHaveLength(500);

		store.dispose();
	});

	it("chat limit: showEarlier pages a quarter back in from the cache", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		await cache.impl.commit(
			CONV_ID,
			Array.from({ length: 500 }, (_, i) => makeStoredChunk(i + 1)),
		);

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
		});

		await store.load();
		expect(store.chunks[0]?.seq).toBe(426);

		await store.showEarlier(); // +ceil(100/4) = 25 older chunks
		expect(store.chunks).toHaveLength(100);
		expect(store.chunks[0]?.seq).toBe(401);
		expect(store.hasEarlier).toBe(true);

		store.dispose();
	});

	it("chat limit: showEarlier clears hasEarlier when the cache is exhausted", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		await cache.impl.commit(
			CONV_ID,
			Array.from({ length: 80 }, (_, i) => makeStoredChunk(i + 1)),
		);

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
		});

		await store.load(); // window 75: hidden 1..5
		expect(store.chunks).toHaveLength(75);
		expect(store.hasEarlier).toBe(true);

		await store.showEarlier(); // restores all 5 → nothing left below
		expect(store.chunks).toHaveLength(80);
		expect(store.chunks[0]?.seq).toBe(1);
		expect(store.hasEarlier).toBe(false);

		store.dispose();
	});

	it("chat limit: a post-trim history sync does not resurrect unloaded chunks", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		await cache.impl.commit(
			CONV_ID,
			Array.from({ length: 500 }, (_, i) => makeStoredChunk(i + 1)),
		);

		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
			chatLimit: 100,
		});

		await store.load();
		expect(store.chunks[0]?.seq).toBe(426);

		// A sealed turn triggers syncTail, whose cache.commit returns the FULL
		// merged cache (seqs 1..501) — the watermark must keep 1..425 out.
		historySync.returnChunks = [makeStoredChunk(501)];
		store.handleDelta(deltaEvent({ type: "turn-start", conversationId: CONV_ID, turnId: "t9" }));
		store.handleDelta(deltaEvent({ type: "turn-sealed", conversationId: CONV_ID, turnId: "t9" }));

		await vi.waitFor(() => {
			expect(store.chunks[store.chunks.length - 1]?.seq).toBe(501);
		});
		expect(store.chunks[0]?.seq).toBe(426);
		expect(store.chunks).toHaveLength(76);

		store.dispose();
	});

	it("resync is a no-op after dispose", async () => {
		const transport = createFakeTransport();
		const historySync = createFakeHistorySync();
		const metricsSync = createFakeMetricsSync();
		const cache = createFakeCache();
		const store = createChatStore({
			conversationId: CONV_ID,
			transport: transport.impl,
			historySync: historySync.impl,
			metricsSync: metricsSync.impl,
			cache: cache.impl,
		});

		store.dispose();
		store.resync();

		await new Promise((r) => setTimeout(r, 10));
		expect(historySync.calls).toHaveLength(0);
		expect(metricsSync.calls).toHaveLength(0);
	});
});
