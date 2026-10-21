import { describe, expect, it } from "vitest";
import { initialPanelKeys, reconcilePanelKeys, swappedPanels } from "./panel-keys";

describe("initialPanelKeys", () => {
  it("numbers the panels in order and seeds past them", () => {
    expect(initialPanelKeys(["tabs", "model"])).toEqual({
      views: ["tabs", "model"],
      keys: [0, 1],
      seed: 2,
    });
  });
});

describe("reconcilePanelKeys", () => {
  const start = initialPanelKeys(["tabs", "model", "usage"]); // keys 0 1 2

  it("closing the MIDDLE panel drops the middle key (not the last)", () => {
    const next = reconcilePanelKeys(start, ["tabs", "usage"]);
    expect(next.keys).toEqual([0, 2]);
    expect(next.seed).toBe(3);
  });

  it("adding a panel gives only the new one a fresh key", () => {
    const next = reconcilePanelKeys(start, ["tabs", "model", "usage", "lsp"]);
    expect(next.keys).toEqual([0, 1, 2, 3]);
    expect(next.seed).toBe(4);
  });

  it("a dropdown swap keeps every key positional", () => {
    const next = reconcilePanelKeys(start, ["tabs", "lsp", "usage"]);
    expect(next.keys).toEqual([0, 1, 2]);
  });

  it("handles duplicate views and never reuses a key", () => {
    const dup = initialPanelKeys(["a", "b", "a"]); // 0 1 2
    const removed = reconcilePanelKeys(dup, ["a", "a"]);
    expect(removed.keys).toEqual([0, 2]);
    const added = reconcilePanelKeys(removed, ["a", "a", "a"]);
    expect(added.keys).toEqual([0, 2, 3]);
    expect(new Set(added.keys).size).toBe(3);
  });

  it("a ✕ hint picks the exact panel when identical views make it ambiguous", () => {
    const twins = initialPanelKeys(["model", "usage", "usage"]); // 0 1 2
    expect(reconcilePanelKeys(twins, ["model", "usage"]).keys).toEqual([0, 1]); // no hint
    expect(reconcilePanelKeys(twins, ["model", "usage"], 1).keys).toEqual([0, 2]);
  });

  it("ignores a stale hint that does not describe the change", () => {
    // The tree changed some other way (e.g. a remote edit) — fall back to LCS.
    expect(reconcilePanelKeys(start, ["tabs", "model"], 0).keys).toEqual([0, 1]);
    expect(reconcilePanelKeys(start, ["tabs", "model", "usage"], 1).keys).toEqual([0, 1, 2]);
  });

  it("an unrelated replacement of different length gets all-fresh keys", () => {
    const next = reconcilePanelKeys(start, ["x"]);
    expect(next.keys).toEqual([3]);
  });
});

describe("swappedPanels", () => {
  it("reports a surviving panel whose view changed", () => {
    const prev = initialPanelKeys(["tabs", "model"]);
    const next = reconcilePanelKeys(prev, ["tabs", "usage"]);
    expect([...swappedPanels(prev, next)]).toEqual([[1, { from: "model", to: "usage" }]]);
  });

  it("does not report adds or removes", () => {
    const prev = initialPanelKeys(["tabs", "model", "usage"]);
    expect(swappedPanels(prev, reconcilePanelKeys(prev, ["tabs", "usage"])).size).toBe(0);
    expect(swappedPanels(prev, reconcilePanelKeys(prev, [...prev.views, "lsp"])).size).toBe(0);
  });
});
