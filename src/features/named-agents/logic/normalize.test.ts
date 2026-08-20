import { describe, expect, it } from "vitest";
import {
  normalizeNamedAgent,
  normalizeNamedAgentRecord,
  normalizeNamedAgents,
  toNamedAgentInput,
} from "./normalize";
import type { NamedAgent } from "./types";

describe("normalizeNamedAgent", () => {
  it("coerces a well-formed record", () => {
    expect(normalizeNamedAgent({ id: "x", name: "Coding", model: "opencode-1/claude" })).toEqual({
      id: "x",
      name: "Coding",
      model: "opencode-1/claude",
    });
  });

  it("rejects a record missing any field", () => {
    expect(normalizeNamedAgent({ id: "x", name: "Coding" })).toBeNull();
    expect(normalizeNamedAgent({ name: "Coding", model: "m" })).toBeNull();
    expect(normalizeNamedAgent(null)).toBeNull();
  });
});

describe("normalizeNamedAgents", () => {
  it("coerces a list body", () => {
    const agents: readonly NamedAgent[] = normalizeNamedAgents({
      namedAgents: [
        { id: "a", name: "Coding", model: "opencode-1/claude" },
        { id: "b", name: "Research", model: "umans/glm" },
      ],
    });
    expect(agents).toHaveLength(2);
    expect(agents[0]?.name).toBe("Coding");
  });

  it("drops malformed entries and survives a missing list key", () => {
    expect(
      normalizeNamedAgents({
        namedAgents: [
          { id: "a", name: "x" },
          { id: "b", name: "y", model: "m" },
        ],
      }).map((a) => a.id),
    ).toEqual(["b"]);
    expect(normalizeNamedAgents({})).toEqual([]);
    expect(normalizeNamedAgents(null)).toEqual([]);
  });
});

describe("normalizeNamedAgentRecord", () => {
  it("reads the canonical saved record", () => {
    expect(
      normalizeNamedAgentRecord({
        namedAgent: { id: "a", name: "Coding", model: "opencode-1/claude" },
      })?.id,
    ).toBe("a");
  });

  it("returns null for a malformed record", () => {
    expect(normalizeNamedAgentRecord({ namedAgent: {} })).toBeNull();
    expect(normalizeNamedAgentRecord({})).toBeNull();
  });
});

describe("toNamedAgentInput", () => {
  it("trims a name and keeps the model", () => {
    expect(toNamedAgentInput("  Coding  ", "opencode-1/claude")).toEqual({
      name: "Coding",
      model: "opencode-1/claude",
    });
  });

  it("defaults non-strings to empty", () => {
    expect(toNamedAgentInput(null, 42)).toEqual({ name: "", model: "" });
  });
});
