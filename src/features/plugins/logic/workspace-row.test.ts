import type { WorkspacePluginRow } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import { rowBlockReason, rowChecked, rowSelectable, stateLabel } from "./workspace-row";

function row(overrides: Partial<WorkspacePluginRow> = {}): WorkspacePluginRow {
  return {
    pluginId: "mcp",
    tier: "standard",
    state: "undefined",
    loaded: true,
    locked: false,
    ...overrides,
  };
}

describe("rowChecked", () => {
  it("is true only for an explicit enabled record", () => {
    expect(rowChecked(row({ state: "enabled" }))).toBe(true);
    expect(rowChecked(row({ state: "disabled" }))).toBe(false);
    expect(rowChecked(row({ state: "undefined" }))).toBe(false);
  });
});

describe("rowSelectable", () => {
  it("is true for a loaded, unlocked row (all three states)", () => {
    for (const state of ["enabled", "disabled", "undefined"] as const) {
      expect(rowSelectable(row({ state }))).toBe(true);
    }
  });

  it("is false for an UNLOADED plugin (§7 strict layering — greyed out)", () => {
    expect(rowSelectable(row({ loaded: false, state: "disabled" }))).toBe(false);
  });

  it("is false for a LOCKED (core) row — the server refuses the PUT (409)", () => {
    expect(rowSelectable(row({ tier: "core", locked: true, state: "enabled" }))).toBe(false);
  });
});

describe("rowBlockReason", () => {
  it("points at the global manager for unloaded plugins", () => {
    const reason = rowBlockReason(row({ loaded: false }));
    expect(reason).toContain("plugin manager");
  });

  it("explains the core lock", () => {
    const reason = rowBlockReason(row({ tier: "core", locked: true }));
    expect(reason).toContain("Core plugins are enabled by default");
  });

  it("prefers the unloaded reason when both apply", () => {
    const reason = rowBlockReason(row({ loaded: false, tier: "core", locked: true }));
    expect(reason).toContain("plugin manager");
  });

  it("is null for an interactive row", () => {
    expect(rowBlockReason(row())).toBeNull();
  });
});

describe("stateLabel", () => {
  it("renders the three wire states in a uniform grammar", () => {
    expect(stateLabel("enabled")).toBe("enabled");
    expect(stateLabel("disabled")).toBe("disabled");
    expect(stateLabel("undefined")).toBe("not set");
  });
});
