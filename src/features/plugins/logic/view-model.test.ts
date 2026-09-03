import type { PluginListResponse, PluginTier } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import { emptyListResponse, node } from "./test-fixtures";
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

  it("normalizes a missing/unknown tier at the boundary so node tiers are canonical", () => {
    // Contract-violation casts: the wire type pins three tier values, but the
    // view-model must survive a backend that emits a tierless or out-of-
    // contract row (the original duplicate-key crash trigger).
    const response = listResponse({
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
          id: "tierless",
          name: "Tierless",
          version: "1.0.0",
          tier: undefined as unknown as PluginTier,
          trust: "external",
          locked: false,
          dependsOn: [],
        },
        {
          id: "kernelish",
          name: "Kernelish",
          version: "1.0.0",
          tier: "kernel" as unknown as PluginTier,
          trust: "external",
          locked: false,
          dependsOn: [],
        },
      ],
    });
    const nodes = pluginNodes(response);
    expect(nodes.find((n) => n.id === "tierless")?.tier).toBe("standard");
    expect(nodes.find((n) => n.id === "kernelish")?.tier).toBe("standard");

    // The Loaded table's grouping: exactly two groups (core + standard), no
    // duplicate keys, every row present.
    const groups = groupByTier(nodes.filter((n) => n.section === "loaded"));
    const keys = groups.map((g) => g.tier);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["core", "standard"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["kernel"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["kernelish", "tierless"]);
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

  it("emits one group per canonical tier, all three present", () => {
    const groups = groupByTier([
      node({ id: "s", tier: "standard" }),
      node({ id: "c", tier: "core" }),
      node({ id: "p", tier: "providers" }),
    ]);
    expect(groups.map((g) => g.tier)).toEqual(["core", "providers", "standard"]);
    expect(groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(["c", "p", "s"]);
  });

  it("never emits duplicate group keys — an unknown tier folds into standard", () => {
    // Contract violation cast: "kernel" is NOT a tier (the kernel hosts
    // plugins, it is not one). groupByTier must stay total anyway.
    const groups = groupByTier([
      node({ id: "s-row", tier: "standard" }),
      node({ id: "k-row", tier: "kernel" as PluginTier }),
    ]);
    const keys = groups.map((g) => g.tier);
    // No duplicates (the keyed each `(group.tier)` crashes on them)…
    expect(new Set(keys).size).toBe(keys.length);
    // …and the unknown-tier row is NOT dropped — it merges into standard.
    expect(keys).toEqual(["standard"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["k-row", "s-row"]);
  });

  it("never emits duplicate group keys — a missing tier folds into standard", () => {
    const groups = groupByTier([
      node({ id: "s-row", tier: "standard" }),
      node({ id: "m-row", tier: undefined as unknown as PluginTier }),
    ]);
    const keys = groups.map((g) => g.tier);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["standard"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["m-row", "s-row"]);
  });

  it("keeps unknown/missing tiers out of the canonical groups' identity (no second standard group)", () => {
    // The old implementation pushed a trailing "rest" group keyed
    // `rest[0]?.tier ?? "standard"` — a DUPLICATE standard key when canonical
    // standard rows existed (the headless-Chromium each_key_duplicate crash).
    const groups = groupByTier([
      node({ id: "a", tier: "standard" }),
      node({ id: "b", tier: "bogus" as PluginTier }),
      node({ id: "c", tier: undefined as unknown as PluginTier }),
    ]);
    expect(groups.map((g) => g.tier)).toEqual(["standard"]);
    expect(groups[0]?.rows).toHaveLength(3);
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
