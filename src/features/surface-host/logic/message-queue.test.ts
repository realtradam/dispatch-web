import type { QueuedMessage } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
  parseMessageQueuePayload,
  reconcileCancelledIds,
  selectVisibleMessages,
} from "./message-queue";

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

describe("selectVisibleMessages", () => {
  it("returns the snapshot unchanged when nothing is cancelled", () => {
    const messages = [msg("m1", "a"), msg("m2", "b")];
    expect(selectVisibleMessages(messages, new Set())).toBe(messages);
  });

  it("hides the optimistically-cancelled row", () => {
    const messages = [msg("m1", "a"), msg("m2", "b"), msg("m3", "c")];
    expect(selectVisibleMessages(messages, new Set(["m2"])).map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("hides multiple cancelled rows", () => {
    const messages = [msg("m1", "a"), msg("m2", "b"), msg("m3", "c")];
    expect(selectVisibleMessages(messages, new Set(["m1", "m3"])).map((m) => m.id)).toEqual(["m2"]);
  });

  it("tolerates a cancelled id not present in the snapshot (no-op)", () => {
    const messages = [msg("m1", "a")];
    expect(selectVisibleMessages(messages, new Set(["ghost"])).map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("reconcileCancelledIds", () => {
  it("returns an empty set when nothing was cancelled", () => {
    const result = reconcileCancelledIds([msg("m1", "a")], new Set());
    expect(result.size).toBe(0);
  });

  it("drops ids the surface confirmed gone (no longer queued)", () => {
    // m1 still queued (cancel pending), m2 confirmed gone (left the snapshot).
    const messages = [msg("m1", "a")];
    const result = reconcileCancelledIds(messages, new Set(["m1", "m2"]));
    expect([...result]).toEqual(["m1"]);
  });

  it("returns the SAME set identity when nothing changed (no spurious cycle)", () => {
    const messages = [msg("m1", "a"), msg("m2", "b")];
    const cancelled = new Set(["m1", "m2"]);
    expect(reconcileCancelledIds(messages, cancelled)).toBe(cancelled);
  });

  it("returns an empty set when all cancels were confirmed", () => {
    const messages = [msg("m1", "a")];
    expect(reconcileCancelledIds(messages, new Set(["m2", "m3"])).size).toBe(0);
  });

  it("keeps a still-queued cancelled id (cancel still pending)", () => {
    const messages = [msg("m1", "a"), msg("m2", "b")];
    const result = reconcileCancelledIds(messages, new Set(["m2"]));
    expect([...result]).toEqual(["m2"]);
  });
});
