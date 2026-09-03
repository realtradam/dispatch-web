import { describe, expect, it } from "vitest";
import { dependencyHighlightSets } from "./highlight";
import { node } from "./test-fixtures";

describe("dependencyHighlightSets", () => {
  const nodes = [
    node({ id: "lib", loaded: false, section: "discovered" }),
    node({ id: "mid", dependsOn: ["lib"] }),
    node({ id: "app", dependsOn: ["mid", "lib"] }),
  ];

  it("returns empty sets for no hover", () => {
    const sets = dependencyHighlightSets(null, nodes);
    expect(sets.deps.size).toBe(0);
    expect(sets.dependents.size).toBe(0);
  });

  it("hovering an item highlights its DIRECT dependencies (one hop)", () => {
    const sets = dependencyHighlightSets("app", nodes);
    expect(sets.deps).toEqual(new Set(["mid", "lib"]));
    expect(sets.dependents.size).toBe(0);
  });

  it("hovering a dependency highlights its dependents (both directions work)", () => {
    const sets = dependencyHighlightSets("lib", nodes);
    expect(sets.deps.size).toBe(0);
    expect(sets.dependents).toEqual(new Set(["mid", "app"]));
  });

  it("hovering a middle node highlights BOTH directions", () => {
    const sets = dependencyHighlightSets("mid", nodes);
    expect(sets.deps).toEqual(new Set(["lib"]));
    expect(sets.dependents).toEqual(new Set(["app"]));
  });

  it("is one hop — not the transitive closure", () => {
    // app → mid → lib: hovering app highlights mid + lib (both direct deps),
    // but hovering lib highlights only DIRECT dependents (mid, app) — already
    // one hop. The one-hop rule shows in: a plugin two hops away via an
    // unrelated chain is not highlighted.
    const chain = [
      node({ id: "a" }),
      node({ id: "b", dependsOn: ["a"] }),
      node({ id: "c", dependsOn: ["b"] }),
    ];
    expect(dependencyHighlightSets("c", chain).deps).toEqual(new Set(["b"]));
  });

  it("returns empty sets for an unknown hovered id", () => {
    const sets = dependencyHighlightSets("ghost", nodes);
    expect(sets.deps.size).toBe(0);
    expect(sets.dependents.size).toBe(0);
  });

  it("works across sections (a loaded row highlights an unloaded dependency)", () => {
    // `app` loaded, `lib` discovered: hovering app still highlights lib.
    const sets = dependencyHighlightSets("app", nodes);
    expect(sets.deps.has("lib")).toBe(true);
  });
});
