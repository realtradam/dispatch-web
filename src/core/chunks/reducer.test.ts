import type {
	StepId,
	StoredChunk,
	TurnDoneEvent,
	TurnErrorEvent,
	TurnInputEvent,
	TurnReasoningDeltaEvent,
	TurnSealedEvent,
	TurnStartEvent,
	TurnTextDeltaEvent,
	TurnToolCallEvent,
	TurnToolResultEvent,
	TurnUsageEvent,
} from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
	appendUserMessage,
	applyHistory,
	clearGenerating,
	foldEvent,
	initialState,
} from "./reducer";
import { selectChunks, selectGenerating, selectMessages } from "./selectors";

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
	stepId = "s0",
): TurnToolCallEvent => ({
	type: "tool-call",
	conversationId: "c1",
	turnId,
	toolCallId,
	toolName,
	input,
	stepId: stepId as StepId,
});

const toolResult = (
	turnId: string,
	toolCallId: string,
	toolName: string,
	content: string,
	stepId = "s0",
): TurnToolResultEvent => ({
	type: "tool-result",
	conversationId: "c1",
	turnId,
	toolCallId,
	toolName,
	content,
	isError: false,
	stepId: stepId as StepId,
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
		expect(s.generating).toBe(false);
	});
});

describe("foldEvent — generating (turn-running state)", () => {
	it("turn-start sets generating true", () => {
		let s = initialState();
		expect(selectGenerating(s)).toBe(false);
		s = foldEvent(s, turnStart("t1"));
		expect(s.generating).toBe(true);
		expect(selectGenerating(s)).toBe(true);
	});

	it("a content delta sets generating true (e.g. a late-joiner replay missing turn-start)", () => {
		let s = initialState();
		s = foldEvent(s, textDelta("t1", "hi"));
		expect(s.generating).toBe(true);
		s = initialState();
		s = foldEvent(s, reasoningDelta("t1", "hmm"));
		expect(s.generating).toBe(true);
		s = initialState();
		s = foldEvent(s, toolCall("t1", "tc1", "bash", {}));
		expect(s.generating).toBe(true);
	});

	it("stays generating across the turn's deltas", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "wor"));
		s = foldEvent(s, textDelta("t1", "king"));
		expect(s.generating).toBe(true);
	});

	it("done clears generating", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "answer"));
		s = foldEvent(s, doneEvent("t1"));
		expect(s.generating).toBe(false);
	});

	it("turn-sealed clears generating", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, turnSealed("t1"));
		expect(s.generating).toBe(false);
	});

	it("error clears generating", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, errorEvent("t1", "boom"));
		expect(s.generating).toBe(false);
	});

	it("a new turn re-asserts generating after the previous one finished", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, doneEvent("t1"));
		s = foldEvent(s, turnSealed("t1"));
		expect(s.generating).toBe(false);
		s = foldEvent(s, turnStart("t2"));
		expect(s.generating).toBe(true);
	});

	it("status does not change generating (free-form string, not inferred)", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		const next = foldEvent(s, { type: "status", conversationId: "c1", status: "idle" });
		expect(next.generating).toBe(true);
	});
});

describe("clearGenerating", () => {
	it("clears a set generating flag", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		expect(s.generating).toBe(true);
		const cleared = clearGenerating(s);
		expect(cleared.generating).toBe(false);
	});

	it("returns the same object when already not generating (no-op)", () => {
		const s = initialState();
		expect(clearGenerating(s)).toBe(s);
	});

	it("preserves transcript content while clearing generating", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "partial"));
		const cleared = clearGenerating(s);
		expect(cleared.generating).toBe(false);
		expect(cleared.accumulating).toEqual({ kind: "text", text: "partial" });
		expect(cleared.currentTurnId).toBe("t1");
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
		s = foldEvent(s, toolCall("t1", "tc1", "bash", { cmd: "ls" }, "t1#0"));
		s = foldEvent(s, toolResult("t1", "tc1", "bash", "file.txt", "t1#0"));
		expect(s.provisional).toHaveLength(2);
		expect(s.provisional[0]?.role).toBe("assistant");
		// foldEvent copies the event's stepId onto the chunk (grouping key).
		expect(s.provisional[0]?.chunk).toEqual({
			type: "tool-call",
			toolCallId: "tc1",
			toolName: "bash",
			input: { cmd: "ls" },
			stepId: "t1#0",
		});
		expect(s.provisional[1]?.role).toBe("tool");
		expect(s.provisional[1]?.chunk).toEqual({
			type: "tool-result",
			toolCallId: "tc1",
			toolName: "bash",
			content: "file.txt",
			isError: false,
			stepId: "t1#0",
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

describe("foldEvent — user-message (the turn's user prompt; backend CR-3)", () => {
	const userMessage = (text: string): TurnInputEvent => ({
		type: "user-message",
		conversationId: "c1",
		turnId: "t1",
		text,
	});

	it("a watcher renders the prompt: appends a provisional user chunk + marks generating", () => {
		let s = initialState();
		s = foldEvent(s, userMessage("what is 2+2?"));
		const chunks = selectChunks(s);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.role).toBe("user");
		expect(chunks[0]?.chunk).toEqual({ type: "text", text: "what is 2+2?" });
		expect(chunks[0]?.provisional).toBe(true);
		expect(s.generating).toBe(true);
	});

	it("dedups the SENDER's optimistic echo (no duplicate user bubble)", () => {
		let s = initialState();
		s = appendUserMessage(s, "hi"); // optimistic echo from the sender's send()
		s = foldEvent(s, userMessage("hi")); // server echo for the same turn
		const users = selectChunks(s).filter((c) => c.role === "user");
		expect(users).toHaveLength(1);
	});

	it("appends when the trailing provisional differs (no false dedup)", () => {
		let s = initialState();
		s = appendUserMessage(s, "first");
		s = foldEvent(s, userMessage("second"));
		const users = selectChunks(s).filter((c) => c.role === "user");
		expect(users).toHaveLength(2);
	});

	it("ignores an empty user-message", () => {
		let s = initialState();
		s = foldEvent(s, userMessage(""));
		expect(selectChunks(s)).toHaveLength(0);
		expect(s.generating).toBe(false);
	});

	it("flushes an accumulating chunk before appending the prompt", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "partial"));
		s = foldEvent(s, userMessage("new prompt"));
		// the partial assistant text was flushed to provisional, then the user prompt appended
		expect(s.accumulating).toBeNull();
		const roles = selectChunks(s).map((c) => c.role);
		expect(roles).toEqual(["assistant", "user"]);
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

	it("marks ONLY the actively-accumulating chunk as streaming", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		// A flushed-but-still-provisional thinking chunk, then a live accumulating one.
		s = foldEvent(s, reasoningDelta("t1", "first thought"));
		s = foldEvent(s, toolCall("t1", "tc1", "bash", {})); // flushes the thinking
		s = foldEvent(s, textDelta("t1", "now writing"));
		const chunks = selectChunks(s);
		const thinking = chunks.find((c) => c.chunk.type === "thinking");
		const accumulating = chunks.find((c) => c.streaming === true);
		expect(thinking?.streaming).toBeFalsy(); // flushed → not streaming
		expect(accumulating?.chunk).toEqual({ type: "text", text: "now writing" });
		expect(chunks.filter((c) => c.streaming === true)).toHaveLength(1);
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

describe("appendUserMessage", () => {
	it("adds a provisional user text chunk", () => {
		let s = initialState();
		s = appendUserMessage(s, "hello from user");
		const chunks = selectChunks(s);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.seq).toBeNull();
		expect(chunks[0]?.role).toBe("user");
		expect(chunks[0]?.chunk).toEqual({ type: "text", text: "hello from user" });
		expect(chunks[0]?.provisional).toBe(true);
	});

	it("selectMessages includes the optimistic user message", () => {
		let s = initialState();
		s = appendUserMessage(s, "what is 2+2?");
		const msgs = selectMessages(s);
		expect(msgs).toHaveLength(1);
		expect(msgs[0]?.role).toBe("user");
		expect(msgs[0]?.chunks).toHaveLength(1);
		expect(msgs[0]?.chunks[0]).toEqual({ type: "text", text: "what is 2+2?" });
	});

	it("user echo then turn-sealed + applyHistory supersedes the provisional user chunk", () => {
		let s = initialState();
		s = appendUserMessage(s, "hi");
		expect(selectChunks(s)).toHaveLength(1);

		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "hello back"));
		s = foldEvent(s, turnSealed("t1"));
		s = applyHistory(s, [
			storedChunk(1, "user", { type: "text", text: "hi" }),
			storedChunk(2, "assistant", { type: "text", text: "hello back" }),
		]);
		const chunks = selectChunks(s);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.seq).toBe(1);
		expect(chunks[0]?.role).toBe("user");
		expect(chunks[0]?.chunk).toEqual({ type: "text", text: "hi" });
		expect(chunks[0]?.provisional).toBe(false);
		expect(chunks[1]?.seq).toBe(2);
		expect(chunks[1]?.role).toBe("assistant");
		expect(chunks[1]?.provisional).toBe(false);
	});

	it("flushes accumulating chunk before appending user message", () => {
		let s = initialState();
		s = foldEvent(s, turnStart("t1"));
		s = foldEvent(s, textDelta("t1", "partial"));
		expect(s.accumulating).toEqual({ kind: "text", text: "partial" });

		s = appendUserMessage(s, "user msg");
		expect(s.accumulating).toBeNull();
		expect(s.provisional).toHaveLength(2);
		expect(s.provisional[0]?.role).toBe("assistant");
		expect(s.provisional[0]?.chunk).toEqual({ type: "text", text: "partial" });
		expect(s.provisional[1]?.role).toBe("user");
		expect(s.provisional[1]?.chunk).toEqual({ type: "text", text: "user msg" });
	});
});
