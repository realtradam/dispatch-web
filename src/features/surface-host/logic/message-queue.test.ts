import type { QueuedMessage } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { parseMessageQueuePayload } from "./message-queue";

const msg = (id: string, text: string, queuedAt = 1_700_000_000_000): QueuedMessage => ({
  id,
  text,
  queuedAt,
});

describe("parseMessageQueuePayload", () => {
  it("parses a well-formed payload with messages", () => {
    const data = parseMessageQueuePayload({
      messages: [msg("m1", "steer left"), msg("m2", "actually, go right")],
    });
    expect(data).toEqual({
      messages: [msg("m1", "steer left"), msg("m2", "actually, go right")],
    });
  });

  it("parses an empty-messages payload (queue is empty)", () => {
    expect(parseMessageQueuePayload({ messages: [] })).toEqual({ messages: [] });
  });

  it("preserves message order", () => {
    const data = parseMessageQueuePayload({
      messages: [msg("a", "first"), msg("b", "second"), msg("c", "third")],
    });
    expect(data?.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it.each([
    ["null", null],
    ["a number", 7],
    ["a string", "nope"],
    ["missing messages key", { foo: [] }],
    ["messages not an array", { messages: "x" }],
    ["entry not an object", { messages: ["x"] }],
    ["entry missing id", { messages: [{ text: "x", queuedAt: 1 }] }],
    ["entry with non-string id", { messages: [{ id: 1, text: "x", queuedAt: 1 }] }],
    ["entry missing text", { messages: [{ id: "m1", queuedAt: 1 }] }],
    ["entry with non-string text", { messages: [{ id: "m1", text: 1, queuedAt: 1 }] }],
    ["entry missing queuedAt", { messages: [{ id: "m1", text: "x" }] }],
    ["entry with non-finite queuedAt", { messages: [msg("m1", "x", Number.NaN)] }],
  ])("returns null for invalid payload: %s", (_label, payload) => {
    expect(parseMessageQueuePayload(payload)).toBeNull();
  });
});
