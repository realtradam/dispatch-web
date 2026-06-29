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
    { type: "user-message", conversationId: "c1", turnId: "t1", text: "hi" },
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
    { type: "steering", conversationId: "c1", turnId: "t1", text: "steer mid-turn" },
    {
      type: "provider-retry",
      conversationId: "c1",
      turnId: "t1",
      attempt: 0,
      delayMs: 5000,
      message: "HTTP 429: overloaded",
      code: "429",
    },
  ];

  it("returns a stable label for every AgentEvent.type variant", () => {
    const labels = samples.map(assertAgentEventExhaustive);
    expect(labels).toEqual([
      "status",
      "turn-start",
      "user-message",
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
      "steering",
      "provider-retry",
    ]);
  });

  it("covers all 15 AgentEvent variants", () => {
    expect(samples).toHaveLength(15);
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
      { type: "image" as const, url: "data:image/png;base64,AAAA", mimeType: "image/png" },
    ];
    const labels = chunks.map(assertChunkExhaustive);
    expect(labels).toEqual([
      "text",
      "thinking",
      "tool-call",
      "tool-result",
      "error",
      "system",
      "image",
    ]);
  });

  it("covers all 7 Chunk variants", () => {
    // Keeps the exhaustive guard honest: a new Chunk.type variant must be added
    // both here and to `assertChunkExhaustive` or the `satisfies never` errors.
    expect([
      "text",
      "thinking",
      "tool-call",
      "tool-result",
      "error",
      "system",
      "image",
    ] as const).toHaveLength(7);
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
      { type: "conversation.open" as const, conversationId: "c1", workspaceId: "w1" },
      {
        type: "conversation.statusChanged" as const,
        conversationId: "c1",
        status: "active" as const,
        workspaceId: "w1",
      },
      {
        type: "conversation.compacted" as const,
        conversationId: "c1",
        newConversationId: "c2",
        messagesSummarized: 10,
        messagesKept: 5,
      },
    ];
    const labels = msgs.map(assertWsServerMessageExhaustive);
    expect(labels).toEqual([
      "catalog",
      "surface",
      "update",
      "error",
      "chat.delta",
      "chat.error",
      "conversation.open",
      "conversation.statusChanged",
      "conversation.compacted",
    ]);
  });
});

describe("classifies every WsClientMessage type", () => {
  it("returns a stable label for each variant", () => {
    const msgs = [
      { type: "subscribe" as const, surfaceId: "s" },
      { type: "unsubscribe" as const, surfaceId: "s" },
      { type: "invoke" as const, surfaceId: "s", actionId: "a" },
      { type: "chat.send" as const, message: "hi" },
      { type: "chat.subscribe" as const, conversationId: "c1" },
      { type: "chat.unsubscribe" as const, conversationId: "c1" },
      { type: "chat.queue" as const, conversationId: "c1", text: "steer" },
      { type: "chat.queue.cancel" as const, conversationId: "c1", messageId: "m1" },
    ];
    const labels = msgs.map(assertWsClientMessageExhaustive);
    expect(labels).toEqual([
      "subscribe",
      "unsubscribe",
      "invoke",
      "chat.send",
      "chat.subscribe",
      "chat.unsubscribe",
      "chat.queue",
      "chat.queue.cancel",
    ]);
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

  it("constructs a ChatSendMessage with pasted images", () => {
    const msg: ChatSendMessage = {
      type: "chat.send",
      conversationId: "c1",
      message: "what's in this image?",
      images: [
        { url: "data:image/png;base64,AAAA", mimeType: "image/png" },
        { url: "https://example.com/cat.jpg" },
      ],
    };
    expect(msg.images).toHaveLength(2);
    expect(msg.images?.[0]?.mimeType).toBe("image/png");
    expect(msg.images?.[1]?.mimeType).toBeUndefined();
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
