import { describe, expect, it } from "vitest";
import { nextBackoffMs, parseServerMessage, serialize } from "./logic";

describe("serialize — workspace.set (plan 06 §6.4)", () => {
  it("serializes a workspace.set client message", () => {
    const msg = { type: "workspace.set" as const, workspaceId: "ws-1" };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });
});

describe("serialize", () => {
  it("serializes a subscribe message", () => {
    const msg = { type: "subscribe" as const, surfaceId: "s1" };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });

  it("serializes an unsubscribe message", () => {
    const msg = { type: "unsubscribe" as const, surfaceId: "s1" };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });

  it("serializes an invoke message with payload", () => {
    const msg = { type: "invoke" as const, surfaceId: "s1", actionId: "toggle", payload: true };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });

  it("serializes an invoke message without payload", () => {
    const msg = { type: "invoke" as const, surfaceId: "s1", actionId: "click" };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });

  it("serializes a chat.send message", () => {
    const msg = { type: "chat.send" as const, message: "hello" };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });

  it("serializes a chat.send message with all fields", () => {
    const msg = {
      type: "chat.send" as const,
      conversationId: "c1",
      message: "hello",
      model: "openai/gpt-4",
      cwd: "/tmp",
    };
    expect(JSON.parse(serialize(msg))).toEqual(msg);
  });
});

describe("parseServerMessage", () => {
  it("parses a catalog message", () => {
    const data = JSON.stringify({
      type: "catalog",
      catalog: [{ id: "s1", region: "r", title: "S1" }],
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({
      type: "catalog",
      catalog: [{ id: "s1", region: "r", title: "S1" }],
    });
  });

  it("parses a surface message", () => {
    const data = JSON.stringify({
      type: "surface",
      spec: { id: "s1", region: "r", title: "S1", fields: [] },
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({
      type: "surface",
      spec: { id: "s1", region: "r", title: "S1", fields: [] },
    });
  });

  it("preserves the conversationId echo on a scoped surface message", () => {
    const data = JSON.stringify({
      type: "surface",
      spec: { id: "s1", region: "r", title: "S1", fields: [] },
      conversationId: "c1",
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({
      type: "surface",
      spec: { id: "s1", region: "r", title: "S1", fields: [] },
      conversationId: "c1",
    });
  });

  it("rejects a surface message with a non-string conversationId", () => {
    const data = JSON.stringify({
      type: "surface",
      spec: { id: "s1", region: "r", title: "S1", fields: [] },
      conversationId: 42,
    });
    expect(parseServerMessage(data)).toBeNull();
  });

  it("parses an update message", () => {
    const data = JSON.stringify({
      type: "update",
      update: {
        surfaceId: "s1",
        spec: { id: "s1", region: "r", title: "S1", fields: [] },
      },
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({
      type: "update",
      update: {
        surfaceId: "s1",
        spec: { id: "s1", region: "r", title: "S1", fields: [] },
      },
    });
  });

  it("parses an error message with surfaceId", () => {
    const data = JSON.stringify({ type: "error", surfaceId: "s1", message: "boom" });
    const result = parseServerMessage(data);
    expect(result).toEqual({ type: "error", surfaceId: "s1", message: "boom" });
  });

  it("parses an error message without surfaceId", () => {
    const data = JSON.stringify({ type: "error", message: "global boom" });
    const result = parseServerMessage(data);
    expect(result).toEqual({ type: "error", message: "global boom" });
  });

  it("returns null for malformed JSON", () => {
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage("{broken")).toBeNull();
    expect(parseServerMessage("")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseServerMessage("42")).toBeNull();
    expect(parseServerMessage('"hello"')).toBeNull();
    expect(parseServerMessage("null")).toBeNull();
    expect(parseServerMessage("true")).toBeNull();
    expect(parseServerMessage("[1,2,3]")).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(parseServerMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
  });

  it("returns null when type is missing", () => {
    expect(parseServerMessage(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null when type is not a string", () => {
    expect(parseServerMessage(JSON.stringify({ type: 42 }))).toBeNull();
  });

  it("returns null for catalog with non-array catalog field", () => {
    expect(parseServerMessage(JSON.stringify({ type: "catalog", catalog: "nope" }))).toBeNull();
  });

  it("returns null for surface with missing spec fields", () => {
    expect(parseServerMessage(JSON.stringify({ type: "surface", spec: { id: "s1" } }))).toBeNull();
  });

  it("returns null for surface with non-object spec", () => {
    expect(parseServerMessage(JSON.stringify({ type: "surface", spec: "nope" }))).toBeNull();
  });

  it("returns null for update with missing update field", () => {
    expect(parseServerMessage(JSON.stringify({ type: "update" }))).toBeNull();
  });

  it("returns null for update with invalid spec", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "update", update: { surfaceId: "s1", spec: {} } })),
    ).toBeNull();
  });

  it("returns null for error with non-string message", () => {
    expect(parseServerMessage(JSON.stringify({ type: "error", message: 42 }))).toBeNull();
  });

  it("returns null for error with invalid surfaceId type", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "error", surfaceId: 42, message: "boom" })),
    ).toBeNull();
  });

  it("parses a chat.delta message", () => {
    const event = { type: "text-delta", conversationId: "c1", turnId: "t1", delta: "hello" };
    const data = JSON.stringify({ type: "chat.delta", event });
    const result = parseServerMessage(data);
    expect(result).toEqual({ type: "chat.delta", event });
  });

  it("parses a chat.error message with conversationId", () => {
    const data = JSON.stringify({
      type: "chat.error",
      conversationId: "c1",
      message: "bad request",
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({ type: "chat.error", conversationId: "c1", message: "bad request" });
  });

  it("parses a chat.error message without conversationId", () => {
    const data = JSON.stringify({ type: "chat.error", message: "no conversation" });
    const result = parseServerMessage(data);
    expect(result).toEqual({ type: "chat.error", message: "no conversation" });
  });

  it("returns null for chat.delta with non-object event", () => {
    expect(parseServerMessage(JSON.stringify({ type: "chat.delta", event: "nope" }))).toBeNull();
  });

  it("returns null for chat.delta with missing event.type", () => {
    expect(parseServerMessage(JSON.stringify({ type: "chat.delta", event: {} }))).toBeNull();
  });

  it("returns null for chat.error with non-string message", () => {
    expect(parseServerMessage(JSON.stringify({ type: "chat.error", message: 42 }))).toBeNull();
  });

  it("returns null for chat.error with invalid conversationId type", () => {
    expect(
      parseServerMessage(
        JSON.stringify({ type: "chat.error", conversationId: 42, message: "boom" }),
      ),
    ).toBeNull();
  });

  it("parses a conversation.open message", () => {
    const data = JSON.stringify({
      type: "conversation.open",
      conversationId: "c1",
      workspaceId: "w1",
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({
      type: "conversation.open",
      conversationId: "c1",
      workspaceId: "w1",
    });
  });

  it("parses a conversation.open message with a persisted model", () => {
    const data = JSON.stringify({
      type: "conversation.open",
      conversationId: "c1",
      workspaceId: "w1",
      model: "openrouter/stealth/ox-alpha",
    });
    const result = parseServerMessage(data);
    expect(result).toEqual({
      type: "conversation.open",
      conversationId: "c1",
      workspaceId: "w1",
      model: "openrouter/stealth/ox-alpha",
    });
  });

  it("omits the model when conversation.open carries a non-string/empty model", () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: "conversation.open",
        conversationId: "c1",
        workspaceId: "w1",
        model: 42,
      }),
    );
    expect(result).toEqual({
      type: "conversation.open",
      conversationId: "c1",
      workspaceId: "w1",
    });
  });

  it("returns null for conversation.open with missing conversationId", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "conversation.open", workspaceId: "w1" })),
    ).toBeNull();
  });

  it("returns null for conversation.open with non-string conversationId", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: "conversation.open",
          conversationId: 42,
          workspaceId: "w1",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for conversation.open with missing workspaceId", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "conversation.open", conversationId: "c1" })),
    ).toBeNull();
  });

  it("returns null for conversation.open with non-string workspaceId", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: "conversation.open",
          conversationId: "c1",
          workspaceId: 42,
        }),
      ),
    ).toBeNull();
  });

  it("parses a conversation.statusChanged message", () => {
    const data = JSON.stringify({
      type: "conversation.statusChanged",
      conversationId: "c1",
      status: "active",
      workspaceId: "w1",
    });
    expect(parseServerMessage(data)).toEqual({
      type: "conversation.statusChanged",
      conversationId: "c1",
      status: "active",
      workspaceId: "w1",
    });
  });

  it("accepts the `queued` status (CR-13 — waiting for a concurrency slot)", () => {
    const data = JSON.stringify({
      type: "conversation.statusChanged",
      conversationId: "c1",
      status: "queued",
      workspaceId: "w1",
    });
    expect(parseServerMessage(data)).toEqual({
      type: "conversation.statusChanged",
      conversationId: "c1",
      status: "queued",
      workspaceId: "w1",
    });
  });

  it("returns null for conversation.statusChanged with missing workspaceId", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: "conversation.statusChanged",
          conversationId: "c1",
          status: "active",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for conversation.statusChanged with non-string workspaceId", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: "conversation.statusChanged",
          conversationId: "c1",
          status: "active",
          workspaceId: 42,
        }),
      ),
    ).toBeNull();
  });
  it("returns null for conversation.statusChanged with invalid status", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: "conversation.statusChanged",
          conversationId: "c1",
          status: "done",
          workspaceId: "w1",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for conversation.statusChanged with missing conversationId", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "conversation.statusChanged", status: "idle" })),
    ).toBeNull();
  });
});

describe("round-trip: parseServerMessage(serialize(...))", () => {
  it("round-trips a subscribe message through serialize only", () => {
    const msg = { type: "subscribe" as const, surfaceId: "s1" };
    const wire = serialize(msg);
    expect(JSON.parse(wire)).toEqual(msg);
  });

  it("round-trips an invoke message with payload", () => {
    const msg = { type: "invoke" as const, surfaceId: "s1", actionId: "toggle", payload: false };
    const wire = serialize(msg);
    expect(JSON.parse(wire)).toEqual(msg);
  });
});

describe("nextBackoffMs", () => {
  it("returns a positive number", () => {
    expect(nextBackoffMs(0)).toBeGreaterThan(0);
  });

  it("is capped at 30s + jitter (at most ~36s)", () => {
    for (let i = 0; i < 100; i++) {
      expect(nextBackoffMs(100)).toBeLessThanOrEqual(36_000);
    }
  });

  it("starts around 500ms (±20% jitter)", () => {
    for (let i = 0; i < 100; i++) {
      const ms = nextBackoffMs(0);
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThanOrEqual(600);
    }
  });

  it("grows exponentially with attempt", () => {
    const averages = [0, 1, 2, 3].map((attempt) => {
      let sum = 0;
      for (let i = 0; i < 200; i++) {
        sum += nextBackoffMs(attempt);
      }
      return sum / 200;
    });
    for (let i = 1; i < averages.length; i++) {
      const prev = averages[i - 1];
      if (prev === undefined) throw new Error("unreachable");
      expect(averages[i]).toBeGreaterThan(prev);
    }
  });

  it("treats negative attempt as 0", () => {
    for (let i = 0; i < 50; i++) {
      const ms = nextBackoffMs(-5);
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThanOrEqual(600);
    }
  });
});

describe("parseServerMessage — extensions-changed (plan 05)", () => {
  it("parses the broadcast with a pluginId", () => {
    const result = parseServerMessage(
      JSON.stringify({ type: "extensions-changed", action: "unload", pluginId: "mcp" }),
    );
    expect(result).toEqual({ type: "extensions-changed", action: "unload", pluginId: "mcp" });
  });

  it("parses a scan broadcast (no pluginId)", () => {
    const result = parseServerMessage(
      JSON.stringify({ type: "extensions-changed", action: "scan" }),
    );
    expect(result).toEqual({ type: "extensions-changed", action: "scan" });
  });

  it("rejects an unknown action", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "extensions-changed", action: "explode" })),
    ).toBeNull();
  });

  it("rejects a missing action", () => {
    expect(parseServerMessage(JSON.stringify({ type: "extensions-changed" }))).toBeNull();
  });
});

describe("parseServerMessage — layout (plan 02)", () => {
  const TREE = { version: 1, root: { kind: "leaf", view: "chat" } };

  it("parses the broadcast (workspaceId + full tree)", () => {
    const result = parseServerMessage(
      JSON.stringify({ type: "layout", workspaceId: "ws-a", tree: TREE }),
    );
    expect(result).toEqual({ type: "layout", workspaceId: "ws-a", tree: TREE });
  });

  it("rejects a missing/invalid workspaceId", () => {
    expect(parseServerMessage(JSON.stringify({ type: "layout", tree: TREE }))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ type: "layout", workspaceId: 7, tree: TREE })),
    ).toBeNull();
  });

  it("rejects a missing/invalid tree (wrong version, missing root, non-object)", () => {
    expect(parseServerMessage(JSON.stringify({ type: "layout", workspaceId: "ws-a" }))).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: "layout", workspaceId: "ws-a", tree: { version: 2, root: {} } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: "layout", workspaceId: "ws-a", tree: { version: 1 } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ type: "layout", workspaceId: "ws-a", tree: 7 })),
    ).toBeNull();
  });

  it("an unknown type still parses to null (the layout addition doesn't loosen the guard)", () => {
    expect(parseServerMessage(JSON.stringify({ type: "layout.unknown" }))).toBeNull();
  });
});

describe("parseServerMessage — subagent tab groups", () => {
  it("forwards the effective tabGroupParentId on conversation.open", () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: "conversation.open",
        conversationId: "child",
        workspaceId: "w1",
        tabGroupParentId: "parent",
      }),
    );
    expect(result).toEqual({
      type: "conversation.open",
      conversationId: "child",
      workspaceId: "w1",
      tabGroupParentId: "parent",
    });
  });

  it("omits a non-string/empty tabGroupParentId on conversation.open", () => {
    for (const tabGroupParentId of ["", 42, null]) {
      const result = parseServerMessage(
        JSON.stringify({
          type: "conversation.open",
          conversationId: "c1",
          workspaceId: "w1",
          tabGroupParentId,
        }),
      );
      expect(result).toEqual({
        type: "conversation.open",
        conversationId: "c1",
        workspaceId: "w1",
      });
    }
  });

  it("parses conversation.tabGroupChanged with a parent id and with null (ungrouped)", () => {
    for (const tabGroupParentId of ["parent", null]) {
      const msg = {
        type: "conversation.tabGroupChanged",
        conversationId: "c1",
        workspaceId: "w1",
        tabGroupParentId,
      };
      expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg);
    }
  });

  it("rejects a malformed conversation.tabGroupChanged", () => {
    const base = { type: "conversation.tabGroupChanged", conversationId: "c1", workspaceId: "w1" };
    expect(parseServerMessage(JSON.stringify(base))).toBeNull(); // missing (undefined) parent
    expect(parseServerMessage(JSON.stringify({ ...base, tabGroupParentId: "" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...base, tabGroupParentId: 1 }))).toBeNull();
    const { workspaceId: _w, ...noWorkspace } = base;
    expect(
      parseServerMessage(JSON.stringify({ ...noWorkspace, tabGroupParentId: "p" })),
    ).toBeNull();
  });
});
