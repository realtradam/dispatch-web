import type { PluginListResponse } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import { emptyListResponse } from "./test-fixtures";
import { groupByTier, pluginNodes, splitSections } from "./view-model";

function listResponse(overrides: Partial<PluginListResponse> = {}): PluginListResponse {
  return {
    loaded: [
      {
        id: "kernel",
        name: "Kernel",
        version: "1.0.0",
        tier: "core",
        trust: "bundled",
        locked: true,
        dependsOn: [],
      },
      {
        id: "opencode",
        name: "OpenCode",
        version: "2.0.0",
        tier: "providers",
        trust: "bundled",
        locked: false,
        dependsOn: ["kernel"],
      },
    ],
    disabledWithReason: [
      {
        id: "broken",
        name: "Broken",
        version: "0.1.0",
        tier: "standard",
        trust: "local",
        reason: "activation threw",
      },
    ],
    discovered: [
      {
        id: "fresh",
        name: "Fresh",
        version: "3.0.0",
        tier: "standard",
        trust: "external",
        dir: "/plugins/fresh",
      },
    ],
    missing: [{ id: "gone", reason: "directory is gone", disabledAt: "2026-01-01" }],
    ...overrides,
  };
}

describe("pluginNodes", () => {
  it("normalizes every row kind into one node shape", () => {
    const nodes = pluginNodes(listResponse());
    expect(nodes.map((n) => n.id)).toEqual(["kernel", "opencode", "broken", "fresh", "gone"]);
  });

  it("maps loaded rows (loaded: true, locked from the row, deps kept)", () => {
    const nodes = pluginNodes(listResponse());
    const kernel = nodes.find((n) => n.id === "kernel");
    expect(kernel).toMatchObject({
      loaded: true,
      locked: true,
      tier: "core",
      section: "loaded",
      dependsOn: [],
      reason: null,
    });
    const opencode = nodes.find((n) => n.id === "opencode");
    expect(opencode).toMatchObject({ loaded: true, locked: false, dependsOn: ["kernel"] });
  });

  it("maps disabledWithReason rows (unloaded, reason kept, discovered section)", () => {
    const nodes = pluginNodes(listResponse());
    const broken = nodes.find((n) => n.id === "broken");
    expect(broken).toMatchObject({
      loaded: false,
      locked: false,
      reason: "activation threw",
      section: "discovered",
    });
  });

  it("maps discovered rows (unloaded, no reason)", () => {
    const nodes = pluginNodes(listResponse());
    const fresh = nodes.find((n) => n.id === "fresh");
    expect(fresh).toMatchObject({ loaded: false, reason: null, section: "discovered" });
  });

  it("maps missing rows (greyed strip; no trust/version)", () => {
    const nodes = pluginNodes(listResponse());
    const gone = nodes.find((n) => n.id === "gone");
    expect(gone).toMatchObject({
      loaded: false,
      section: "missing",
      reason: "directory is gone",
      trust: null,
      version: "",
    });
  });

  it("handles the empty response", () => {
    expect(pluginNodes(emptyListResponse())).toEqual([]);
  });
});

describe("groupByTier", () => {
  it("clusters rows in tier display order (Core → Providers → Standard)", () => {
    const nodes = pluginNodes(listResponse());
    const groups = groupByTier(nodes.filter((n) => n.section === "loaded"));
    expect(groups.map((g) => g.tier)).toEqual(["core", "providers"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["kernel"]);
  });

  it("omits empty tiers", () => {
    const groups = groupByTier([pluginNodes(listResponse())[2] ?? []].flat());
    expect(groups.map((g) => g.tier)).toEqual(["standard"]);
  });
});

describe("splitSections", () => {
  it("splits the node list into the two tables + the missing strip", () => {
    const sections = splitSections(pluginNodes(listResponse()));
    expect(sections.loaded.map((n) => n.id)).toEqual(["kernel", "opencode"]);
    expect(sections.discovered.map((n) => n.id)).toEqual(["broken", "fresh"]);
    expect(sections.missing.map((n) => n.id)).toEqual(["gone"]);
  });
});
