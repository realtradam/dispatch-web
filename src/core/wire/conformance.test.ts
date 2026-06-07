import type { ChatSendMessage, ConversationHistoryResponse } from "@dispatch/transport-contract";
import type { AgentEvent, StepId, StoredChunk } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
	assertAgentEventExhaustive,
	assertChunkExhaustive,
	assertWsClientMessageExhaustive,
	assertWsServerMessageExhaustive,
} from "./conformance";

describe("StoredChunk round-trips JSON", () => {
	it("preserves shape through JSON serialize/deserialize", () => {
		const original: StoredChunk = {
			seq: 42,
			role: "assistant",
			chunk: { type: "text", text: "hello" },
		};
		const roundTripped: StoredChunk = JSON.parse(JSON.stringify(original)) as StoredChunk;
		expect(roundTripped).toEqual(original);
		expect(roundTripped.seq).toBe(42);
		expect(roundTripped.role).toBe("assistant");
		expect(roundTripped.chunk.type).toBe("text");
	});
});

describe("classifies every AgentEvent type", () => {
	const samples: AgentEvent[] = [
		{ type: "status", conversationId: "c1", status: "idle" },
		{ type: "turn-start", conversationId: "c1", turnId: "t1" },
		{ type: "text-delta", conversationId: "c1", turnId: "t1", delta: "hi" },
		{ type: "reasoning-delta", conversationId: "c1", turnId: "t1", delta: "thinking" },
		{
			type: "tool-call",
			conversationId: "c1",
			turnId: "t1",
			toolCallId: "tc1",
			toolName: "read",
			input: {},
			stepId: "t1#0" as StepId,
		},
		{
			type: "tool-result",
			conversationId: "c1",
			turnId: "t1",
			toolCallId: "tc1",
			toolName: "read",
			content: "ok",
			isError: false,
			stepId: "t1#0" as StepId,
		},
		{
			type: "tool-output",
			conversationId: "c1",
			turnId: "t1",
			toolCallId: "tc1",
			data: "out",
			stream: "stdout",
		},
		{
			type: "usage",
			conversationId: "c1",
			turnId: "t1",
			usage: { inputTokens: 10, outputTokens: 20 },
		},
		{
			type: "step-complete",
			conversationId: "c1",
			turnId: "t1",
			stepId: "t1#0" as StepId,
			ttftMs: 300,
			decodeMs: 700,
			genTotalMs: 1000,
		},
		{ type: "error", conversationId: "c1", turnId: "t1", message: "oops" },
		{ type: "done", conversationId: "c1", turnId: "t1", reason: "complete" },
		{ type: "turn-sealed", conversationId: "c1", turnId: "t1" },
	];

	it("returns a stable label for every AgentEvent.type variant", () => {
		const labels = samples.map(assertAgentEventExhaustive);
		expect(labels).toEqual([
			"status",
			"turn-start",
			"text-delta",
			"reasoning-delta",
			"tool-call",
			"tool-result",
			"tool-output",
			"usage",
			"step-complete",
			"error",
			"done",
			"turn-sealed",
		]);
	});

	it("covers all 12 AgentEvent variants", () => {
		expect(samples).toHaveLength(12);
	});
});

describe("classifies every Chunk type", () => {
	it("returns a stable label for each Chunk.type variant", () => {
		const chunks = [
			{ type: "text" as const, text: "a" },
			{ type: "thinking" as const, text: "b" },
			{ type: "tool-call" as const, toolCallId: "tc", toolName: "n", input: null },
			{
				type: "tool-result" as const,
				toolCallId: "tc",
				toolName: "n",
				content: "c",
				isError: false,
			},
			{ type: "error" as const, message: "e" },
			{ type: "system" as const, text: "s" },
		];
		const labels = chunks.map(assertChunkExhaustive);
		expect(labels).toEqual(["text", "thinking", "tool-call", "tool-result", "error", "system"]);
	});
});

describe("classifies every WsServerMessage type", () => {
	it("returns a stable label for each variant", () => {
		const msgs = [
			{ type: "catalog" as const, catalog: [] },
			{ type: "surface" as const, spec: { id: "s", region: "r", title: "S", fields: [] } },
			{
				type: "update" as const,
				update: { surfaceId: "s", spec: { id: "s", region: "r", title: "S", fields: [] } },
			},
			{ type: "error" as const, message: "e" },
			{
				type: "chat.delta" as const,
				event: { type: "done" as const, conversationId: "c", turnId: "t", reason: "r" },
			},
			{ type: "chat.error" as const, message: "e" },
		];
		const labels = msgs.map(assertWsServerMessageExhaustive);
		expect(labels).toEqual(["catalog", "surface", "update", "error", "chat.delta", "chat.error"]);
	});
});

describe("classifies every WsClientMessage type", () => {
	it("returns a stable label for each variant", () => {
		const msgs = [
			{ type: "subscribe" as const, surfaceId: "s" },
			{ type: "unsubscribe" as const, surfaceId: "s" },
			{ type: "invoke" as const, surfaceId: "s", actionId: "a" },
			{ type: "chat.send" as const, message: "hi" },
		];
		const labels = msgs.map(assertWsClientMessageExhaustive);
		expect(labels).toEqual(["subscribe", "unsubscribe", "invoke", "chat.send"]);
	});
});

describe("ChatSendMessage shape is constructible", () => {
	it("constructs a minimal ChatSendMessage", () => {
		const msg: ChatSendMessage = { type: "chat.send", message: "hello" };
		expect(msg.type).toBe("chat.send");
		expect(msg.message).toBe("hello");
	});

	it("constructs a full ChatSendMessage", () => {
		const msg: ChatSendMessage = {
			type: "chat.send",
			conversationId: "c1",
			message: "hello",
			model: "default/gpt-4",
			cwd: "/tmp",
		};
		expect(msg.conversationId).toBe("c1");
		expect(msg.model).toBe("default/gpt-4");
		expect(msg.cwd).toBe("/tmp");
	});
});

describe("ConversationHistoryResponse shape is constructible", () => {
	it("constructs a response with chunks", () => {
		const resp: ConversationHistoryResponse = {
			chunks: [{ seq: 1, role: "user", chunk: { type: "text", text: "hi" } }],
			latestSeq: 1,
		};
		expect(resp.chunks).toHaveLength(1);
		expect(resp.latestSeq).toBe(1);
	});

	it("constructs an empty (caught-up) response", () => {
		const resp: ConversationHistoryResponse = { chunks: [], latestSeq: 5 };
		expect(resp.chunks).toHaveLength(0);
		expect(resp.latestSeq).toBe(5);
	});
});
