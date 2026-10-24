import type { Workspace } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
  archivedCreateMessage,
  checkFailedCreateMessage,
  gateCreate,
  type WorkspaceLookup,
} from "./create";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "old",
    title: "Old",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    archived: false,
    createdAt: 1,
    lastActivityAt: 2,
    ...overrides,
  };
}

describe("gateCreate", () => {
  it("blocks a slug whose workspace is archived, with the can't-create message", () => {
    const lookup: WorkspaceLookup = { kind: "found", workspace: workspace({ archived: true }) };
    const gate = gateCreate("old", lookup);
    expect(gate).toEqual({ ok: false, error: archivedCreateMessage("old") });
    expect(gate.ok === false && gate.error).toContain(
      'A workspace named "old" already exists and is archived — you can\'t create it.',
    );
  });

  it("proceeds for an existing ACTIVE workspace (ensure is idempotent)", () => {
    const lookup: WorkspaceLookup = { kind: "found", workspace: workspace({ archived: false }) };
    expect(gateCreate("old", lookup)).toEqual({ ok: true });
  });

  it("proceeds for a missing slug", () => {
    expect(gateCreate("fresh", { kind: "missing" })).toEqual({ ok: true });
  });

  it("blocks when the existence probe failed (never guesses)", () => {
    const gate = gateCreate("maybe", { kind: "failed", error: "db down" });
    expect(gate).toEqual({ ok: false, error: checkFailedCreateMessage("maybe", "db down") });
    expect(gate.ok === false && gate.error).toContain(
      'Couldn\'t check whether a workspace named "maybe"',
    );
  });
});
