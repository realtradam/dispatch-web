import { describe, expect, it } from "vitest";
import { findNamedAgent, snapshotFor } from "./snapshot";
import type { NamedAgent } from "./types";

const AGENTS: readonly NamedAgent[] = [
  { id: "a1", name: "Coding Agent", model: "opencode-1/claude-sonnet-4.5" },
  { id: "b2", name: "Research Agent", model: "umans/umans-glm-5.2" },
];

describe("snapshotFor", () => {
  it("builds a snapshot carrying id, name, and the raw model", () => {
    const coding = AGENTS[0];
    if (coding === undefined) throw new Error("test fixture missing");
    expect(coding).toBeDefined();
    expect(snapshotFor(coding)).toEqual({
      namedAgentId: "a1",
      namedAgentName: "Coding Agent",
      model: "opencode-1/claude-sonnet-4.5",
    });
  });
});

describe("findNamedAgent", () => {
  it("finds by stable id", () => {
    expect(findNamedAgent(AGENTS, "b2")?.name).toBe("Research Agent");
  });

  it("finds by name case-insensitively", () => {
    expect(findNamedAgent(AGENTS, "coding agent")?.id).toBe("a1");
  });

  it("returns undefined for an unknown id/name", () => {
    expect(findNamedAgent(AGENTS, "nope")).toBeUndefined();
  });
});
