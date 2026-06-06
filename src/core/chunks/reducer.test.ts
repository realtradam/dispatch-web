import type {
	StoredChunk,
	TurnDoneEvent,
	TurnErrorEvent,
	TurnReasoningDeltaEvent,
	TurnSealedEvent,
	TurnStartEvent,
	TurnTextDeltaEvent,
	TurnToolCallEvent,
	TurnToolResultEvent,
	TurnUsageEvent,
} from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { applyHistory, foldEvent, initialState } from "./reducer";
import { selectChunks, selectMessages } from "./selectors";

const turnStart = (turnId: string): TurnStartEvent => ({
	type: "turn-start",
	conversationId: "c1",
	turnId,
});

const textDelta = (turnId: string, delta: string): TurnTextDeltaEvent => ({
	type: "text-delta",
	conversationId: "c1",
	turnId,
	delta,
});

const reasoningDelta = (turnId: string, delta: string): TurnReasoningDeltaEvent => ({
	type: "reasoning-delta",
	conversationId: "c1",
	turnId,
	delta,
});

const toolCall = (
	turnId: string,
	toolCallId: string,
	toolName: string,
	input: unknown,
): TurnToolCallEvent => ({
	type: "tool-call",
	conversationId: "c1",
	turnId,
	toolCallId,
	toolName,
	input,
});

const toolResult = (
	turnId: string,
	toolCallId: string,
	toolName: string,
	content: string,
): TurnToolResultEvent => ({
	type: "tool-result",
	conversationId: "c1",
	turnId,
	toolCallId,
	toolName,
	content,
	isError: false,
});

const usageEvent = (turnId: string, inputTokens: number, outputTokens: number): TurnUsageEvent => ({
	type: "usage",
	conversationId: "c1",
	turnId,
	usage: { inputTokens, outputTokens },
});

const errorEvent = (turnId: string, message: string, code?: string): TurnErrorEvent =>
	code !== undefined
		? { type: "error", conversationId: "c1", turnId, message, code }
		: { type: "error", conversationId: "c1", turnId, message };

const doneEvent = (turnId: string): TurnDoneEvent => ({
	type: "done",
	conversationId: "c1",
	turnId,
	reason: "stop",
});

const turnSealed = (turnId: string): TurnSealedEvent => ({
	type: "turn-sealed",
	conversationId: "c1",
	turnId,
});

const storedChunk = (
	seq: number,
	role: "user" | "assistant" | "tool" | "system",
	chunk: StoredChunk["chunk"],
): StoredChunk => ({
	seq,
	role,
	chunk,
});

describe("initialState", () => {
	it("initial state is empty", () => {
		const s = initialState();
		expect(s.committed).toEqual([]);
		expect(s.provisional).toEqual([]);
		expect(s.accumulating).toBeNull();
		expect(s.currentTurnId).toBeNull();
		expect(s.latestUsage).toBeNull();
		expect(s.sealedTurnId).toBeNull();
	});
});

describe("foldEvent — text-delta", () => {
	it("text-delta accumulates into one TextChunk", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "hello"));
		expect(s.accumulating).toEqual({ kind: "text", text: "hello" });
		expect(s.provisional).toEqual([]);
	});

	it("successive text-deltas extend the same provisional chunk", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "hello "));
		s = foldEvent(s, textDelta("t1", "world"));
		expect(s.accumulating).toEqual({ kind: "text", text: "hello world" });
		expect(s.provisional).toEqual([]);
	});

	it("text-delta after reasoning-delta flushes thinking and starts text", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, reasoningDelta("t1", "thinking..."));
		s = foldEvent(s, textDelta("t1", "answer"));
		expect(s.accumulating).toEqual({ kind: "text", text: "answer" });
		expect(s.provisional).toHaveLength(1);
		expect(s.provisional[0]?.chunk).toEqual({ type: "thinking", text: "thinking..." });
		expect(s.provisional[0]?.role).toBe("assistant");
	});
});

describe("foldEvent — reasoning-delta", () => {
	it("reasoning-delta yields a thinking chunk", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, reasoningDelta("t1", "hmm"));
		expect(s.accumulating).toEqual({ kind: "thinking", text: "hmm" });
	});

	it("successive reasoning-deltas extend the same chunk", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, reasoningDelta("t1", "hmm "));
		s = foldEvent(s, reasoningDelta("t1", "ok"));
		expect(s.accumulating).toEqual({ kind: "thinking", text: "hmm ok" });
	});
});

describe("foldEvent — tool-call then tool-result", () => {
	it("tool-call then tool-result render in order", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, toolCall("t1", "tc1", "bash", { cmd: "ls" }));
		s = foldEvent(s, toolResult("t1", "tc1", "bash", "file.txt"));
		expect(s.provisional).toHaveLength(2);
		expect(s.provisional[0]?.role).toBe("assistant");
		expect(s.provisional[0]?.chunk).toEqual({
			type: "tool-call",
			toolCallId: "tc1",
			toolName: "bash",
			input: { cmd: "ls" },
		});
		expect(s.provisional[1]?.role).toBe("tool");
		expect(s.provisional[1]?.chunk).toEqual({
			type: "tool-result",
			toolCallId: "tc1",
			toolName: "bash",
			content: "file.txt",
			isError: false,
		});
	});

	it("tool-call flushes accumulating text", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "let me check"));
		s = foldEvent(s, toolCall("t1", "tc1", "bash", {}));
		expect(s.provisional).toHaveLength(2);
		expect(s.provisional[0]?.chunk).toEqual({ type: "text", text: "let me check" });
		expect(s.provisional[1]?.chunk).toMatchObject({ type: "tool-call", toolCallId: "tc1" });
		expect(s.accumulating).toBeNull();
	});
});

describe("foldEvent — turn-sealed", () => {
	it("turn-sealed sets sealedTurnId", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "hi"));
		s = foldEvent(s, turnSealed("t1"));
		expect(s.sealedTurnId).toBe("t1");
		expect(s.accumulating).toBeNull();
		expect(s.provisional).toHaveLength(1);
		expect(s.provisional[0]?.chunk).toEqual({ type: "text", text: "hi" });
	});
});

describe("foldEvent — usage", () => {
	it("stores latest usage", () => {
		let s = initialState();
		s = foldEvent(s, usageEvent("t1", 100, 50));
		expect(s.latestUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
	});

	it("overwrites previous usage", () => {
		let s = initialState();
		s = foldEvent(s, usageEvent("t1", 100, 50));
		s = foldEvent(s, usageEvent("t1", 200, 80));
		expect(s.latestUsage).toEqual({ inputTokens: 200, outputTokens: 80 });
	});
});

describe("foldEvent — error", () => {
	it("creates error chunk with code", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, errorEvent("t1", "bad", "E001"));
		expect(s.provisional).toHaveLength(1);
		expect(s.provisional[0]?.chunk).toEqual({ type: "error", message: "bad", code: "E001" });
		expect(s.provisional[0]?.role).toBe("assistant");
	});

	it("creates error chunk without code", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, errorEvent("t1", "bad"));
		expect(s.provisional).toHaveLength(1);
		expect(s.provisional[0]?.chunk).toEqual({ type: "error", message: "bad" });
	});
});

describe("foldEvent — done", () => {
	it("flushes accumulating chunk on done", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "hello"));
		s = foldEvent(s, doneEvent("t1"));
		expect(s.accumulating).toBeNull();
		expect(s.provisional).toHaveLength(1);
		expect(s.provisional[0]?.chunk).toEqual({ type: "text", text: "hello" });
	});
});

describe("foldEvent — status and tool-output", () => {
	it("status is a no-op", () => {
		const s = initialState();
		const next = foldEvent(s, { type: "status", conversationId: "c1", status: "running" });
		expect(next).toBe(s);
	});

	it("tool-output is a no-op", () => {
		const s = initialState();
		const next = foldEvent(s, {
			type: "tool-output",
			conversationId: "c1",
			turnId: "t1",
			toolCallId: "tc1",
			data: "output",
			stream: "stdout",
		});
		expect(next).toBe(s);
	});
});

describe("applyHistory", () => {
	it("orders committed chunks by seq", () => {
		const s = initialState();
		const chunks = [
			storedChunk(3, "assistant", { type: "text", text: "c" }),
			storedChunk(1, "user", { type: "text", text: "a" }),
			storedChunk(2, "assistant", { type: "text", text: "b" }),
		];
		const next = applyHistory(s, chunks);
		expect(next.committed.map((c) => c.seq)).toEqual([1, 2, 3]);
	});

	it("is idempotent on duplicate seqs", () => {
		let s = initialState();
		const batch1 = [
			storedChunk(1, "user", { type: "text", text: "a" }),
			storedChunk(2, "assistant", { type: "text", text: "b" }),
		];
		s = applyHistory(s, batch1);
		const batch2 = [
			storedChunk(2, "assistant", { type: "text", text: "b" }),
			storedChunk(3, "assistant", { type: "text", text: "c" }),
		];
		s = applyHistory(s, batch2);
		expect(s.committed.map((c) => c.seq)).toEqual([1, 2, 3]);
		expect(s.committed).toHaveLength(3);
	});

	it("supersedes & clears provisional once committed", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "hello"));
		s = foldEvent(s, turnSealed("t1"));
		expect(s.provisional).toHaveLength(1);
		expect(s.sealedTurnId).toBe("t1");

		s = applyHistory(s, [storedChunk(1, "assistant", { type: "text", text: "hello" })]);
		expect(s.provisional).toEqual([]);
		expect(s.accumulating).toBeNull();
		expect(s.sealedTurnId).toBeNull();
		expect(s.committed).toHaveLength(1);
	});

	it("keeps provisional and accumulating when sealedTurnId is null", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "wip"));
		s = foldEvent(s, doneEvent("t1"));
		s = applyHistory(s, [storedChunk(1, "user", { type: "text", text: "q" })]);
		expect(s.provisional).toHaveLength(1);
		expect(s.committed).toHaveLength(1);
	});

	it("merges new history into existing committed", () => {
		let s = initialState();
		s = applyHistory(s, [storedChunk(1, "user", { type: "text", text: "a" })]);
		s = applyHistory(s, [storedChunk(2, "assistant", { type: "text", text: "b" })]);
		expect(s.committed).toHaveLength(2);
		expect(s.committed.map((c) => c.seq)).toEqual([1, 2]);
	});
});

describe("selectChunks", () => {
	it("selectChunks marks provisional with seq null", () => {
		let s = initialState();
		s = applyHistory(s, [storedChunk(1, "user", { type: "text", text: "q" })]);
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "wip"));
		const chunks = selectChunks(s);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.seq).toBe(1);
		expect(chunks[0]?.provisional).toBe(false);
		expect(chunks[1]?.seq).toBeNull();
		expect(chunks[1]?.provisional).toBe(true);
	});

	it("returns empty for empty state", () => {
		expect(selectChunks(initialState())).toEqual([]);
	});

	it("includes accumulating chunk as provisional", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "building..."));
		const chunks = selectChunks(s);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.seq).toBeNull();
		expect(chunks[0]?.provisional).toBe(true);
		expect(chunks[0]?.chunk).toEqual({ type: "text", text: "building..." });
	});
});

describe("selectMessages", () => {
	it("selectMessages groups consecutive same-role chunks", () => {
		let s = initialState();
		s = applyHistory(s, [
			storedChunk(1, "user", { type: "text", text: "q1" }),
			storedChunk(2, "user", { type: "text", text: "q2" }),
			storedChunk(3, "assistant", { type: "text", text: "a1" }),
			storedChunk(4, "assistant", { type: "text", text: "a2" }),
			storedChunk(5, "user", { type: "text", text: "q3" }),
		]);
		const msgs = selectMessages(s);
		expect(msgs).toHaveLength(3);
		expect(msgs[0]?.role).toBe("user");
		expect(msgs[0]?.chunks).toHaveLength(2);
		expect(msgs[1]?.role).toBe("assistant");
		expect(msgs[1]?.chunks).toHaveLength(2);
		expect(msgs[2]?.role).toBe("user");
		expect(msgs[2]?.chunks).toHaveLength(1);
	});

	it("returns empty for empty state", () => {
		expect(selectMessages(initialState())).toEqual([]);
	});

	it("mixes committed and provisional in messages", () => {
		let s = initialState();
		s = applyHistory(s, [storedChunk(1, "user", { type: "text", text: "q" })]);
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "a1"));
		s = foldEvent(s, textDelta("t1", "a2"));
		const msgs = selectMessages(s);
		expect(msgs).toHaveLength(2);
		expect(msgs[0]?.role).toBe("user");
		expect(msgs[0]?.chunks).toHaveLength(1);
		expect(msgs[1]?.role).toBe("assistant");
		expect(msgs[1]?.chunks).toHaveLength(1);
		expect(msgs[1]?.chunks[0]).toEqual({ type: "text", text: "a1a2" });
	});
});
