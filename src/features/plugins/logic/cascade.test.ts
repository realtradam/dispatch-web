import { describe, expect, it } from "vitest";
import { computeCascade } from "./cascade";
import { node } from "./test-fixtures";

describe("computeCascade", () => {
  it("returns [] when the target has no dependents", () => {
    const nodes = [node({ id: "a" }), node({ id: "b" })];
    expect(computeCascade("a", nodes)).toEqual([]);
  });

  it("returns the direct loaded dependents", () => {
    const nodes = [
      node({ id: "heartbeat" }),
      node({ id: "transport-http", dependsOn: ["heartbeat"] }),
    ];
    expect(computeCascade("heartbeat", nodes)).toEqual(["transport-http"]);
  });

  it("is transitive (dependent of dependent)", () => {
    const nodes = [
      node({ id: "a" }),
      node({ id: "b", dependsOn: ["a"] }),
      node({ id: "c", dependsOn: ["b"] }),
    ];
    expect(computeCascade("a", nodes)).toEqual(["b", "c"]);
  });

  it("does NOT traverse through an UNLOADED intermediate (loaded-subgraph closure — server mirror)", () => {
    // c depends on b, b is unloaded: unloading a cascades to b only (b is not
    // collected — unloaded) and does NOT reach c (its dep chain is already unmet).
    const nodes = [
      node({ id: "a" }),
      node({ id: "b", loaded: false, section: "discovered", dependsOn: ["a"] }),
      node({ id: "c", dependsOn: ["b"] }),
    ];
    expect(computeCascade("a", nodes)).toEqual([]);
  });

  it("ignores plugins that merely share a dependency (direction matters)", () => {
    const nodes = [node({ id: "dep" }), node({ id: "x", dependsOn: ["dep"] })];
    expect(computeCascade("x", nodes)).toEqual([]);
  });

  it("handles diamond dependencies without duplicates", () => {
    const nodes = [
      node({ id: "root" }),
      node({ id: "left", dependsOn: ["root"] }),
      node({ id: "right", dependsOn: ["root"] }),
      node({ id: "bottom", dependsOn: ["left", "right"] }),
    ];
    expect(computeCascade("root", nodes)).toEqual(["bottom", "left", "right"]);
  });

  it("returns [] for a target that is not in the list", () => {
    expect(computeCascade("ghost", [node({ id: "a" })])).toEqual([]);
  });

  it("is deterministic (alphabetical order)", () => {
    const nodes = [
      node({ id: "root" }),
      node({ id: "zeta", dependsOn: ["root"] }),
      node({ id: "alpha", dependsOn: ["root"] }),
    ];
    expect(computeCascade("root", nodes)).toEqual(["alpha", "zeta"]);
  });
});
