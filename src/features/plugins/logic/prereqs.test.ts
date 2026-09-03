import { describe, expect, it } from "vitest";
import { autoCheckBackendPrereqs } from "./prereqs";
import { node } from "./test-fixtures";

describe("autoCheckBackendPrereqs", () => {
  it("returns [] when all dependencies are already loaded", () => {
    const nodes = [node({ id: "dep" }), node({ id: "app", dependsOn: ["dep"] })];
    expect(autoCheckBackendPrereqs("app", nodes)).toEqual([]);
  });

  it("returns the unloaded direct dependencies (to auto-check)", () => {
    const nodes = [
      node({ id: "dep", loaded: false, section: "discovered" }),
      node({ id: "other", loaded: false, section: "discovered" }),
      node({ id: "loaded-dep" }),
      node({ id: "app", dependsOn: ["dep", "other", "loaded-dep"] }),
    ];
    // Only the UNLOADED deps are returned (loaded-dep needs no auto-check).
    expect(autoCheckBackendPrereqs("app", nodes)).toEqual(["dep", "other"]);
  });

  it("is transitive (dep of a dep)", () => {
    const nodes = [
      node({ id: "base", loaded: false, section: "discovered" }),
      node({ id: "mid", loaded: false, section: "discovered", dependsOn: ["base"] }),
      node({ id: "app", dependsOn: ["mid"] }),
    ];
    // Load order: dependencies BEFORE their dependents.
    expect(autoCheckBackendPrereqs("app", nodes)).toEqual(["mid", "base"]);
  });

  it("is one-directional: it never pulls DEPENDENTS in (no reverse traversal)", () => {
    // Checking `dep` must not auto-check `app` (app depends on dep, not vice versa).
    const nodes = [
      node({ id: "dep", loaded: false, section: "discovered" }),
      node({ id: "app", dependsOn: ["dep"] }),
    ];
    expect(autoCheckBackendPrereqs("dep", nodes)).toEqual([]);
  });

  it("excludes the target itself and skips already-seen nodes (diamond)", () => {
    const nodes = [
      node({ id: "base", loaded: false, section: "discovered" }),
      node({ id: "left", loaded: false, section: "discovered", dependsOn: ["base"] }),
      node({ id: "right", loaded: false, section: "discovered", dependsOn: ["base"] }),
      node({ id: "app", dependsOn: ["left", "right"] }),
    ];
    expect(autoCheckBackendPrereqs("app", nodes)).toEqual(["left", "right", "base"]);
  });

  it("returns [] for an unknown target", () => {
    expect(autoCheckBackendPrereqs("ghost", [node({ id: "a" })])).toEqual([]);
  });

  it("returns [] for a target with no dependencies", () => {
    expect(autoCheckBackendPrereqs("app", [node({ id: "app" })])).toEqual([]);
  });
});
