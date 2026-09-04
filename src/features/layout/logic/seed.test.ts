import { DEFAULT_LAYOUT, type LayoutTree, type SplitNode } from "@dispatch/layout-contract";
import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_VIEWS, overlaySidePanels, seedLayout } from "./seed";
import { firstCollapsibleNodeId, firstPanelsNode } from "./tree-query";

function sideViews(tree: LayoutTree): string[] {
  const root = tree.root as SplitNode;
  const side = root.children[1]?.node;
  return side?.kind === "panels" ? side.panels.map((p) => p.view) : [];
}

describe("seedLayout", () => {
  it("uses the default panels when nothing is stored", () => {
    const tree = seedLayout(null, ["tabs", "model", "settings"]);
    expect(sideViews(tree)).toEqual(DEFAULT_PANEL_VIEWS);
  });

  it("overlays the stored selection, dropping unknown/removed kinds", () => {
    const tree = seedLayout(
      ["extensions", "ghost-view", "model"],
      ["tabs", "model", "extensions", "settings"],
    );
    expect(sideViews(tree)).toEqual(["extensions", "model"]);
  });

  it("falls back to the defaults when the stored selection is all-unknown or empty", () => {
    expect(sideViews(seedLayout(["ghost"], ["tabs", "model"]))).toEqual(["tabs", "model"]);
    expect(sideViews(seedLayout([], ["tabs", "model"]))).toEqual(["tabs", "model"]);
  });

  it("falls back to the defaults when the stored value is not a string array", () => {
    expect(sideViews(seedLayout("junk", ["tabs", "model"]))).toEqual(["tabs", "model"]);
    expect(sideViews(seedLayout([42], ["tabs", "model"]))).toEqual(["tabs", "model"]);
    expect(sideViews(seedLayout({ a: 1 }, ["tabs", "model"]))).toEqual(["tabs", "model"]);
  });

  it("preserves the default tree's ids and the titlebar-unset invariant", () => {
    const tree = seedLayout(["model"], ["tabs", "model"]);
    expect((tree.root as SplitNode).id).toBe("root");
    expect(tree.titlebar).toBeUndefined();
  });
});

describe("overlaySidePanels", () => {
  it("replaces only the side panels of the given base tree", () => {
    const tree = overlaySidePanels(DEFAULT_LAYOUT, ["settings", "tasks"]);
    expect(sideViews(tree)).toEqual(["settings", "tasks"]);
    // The rest of the tree is untouched.
    expect((tree.root as SplitNode).children[0]?.node).toEqual(
      (DEFAULT_LAYOUT.root as SplitNode).children[0]?.node,
    );
  });
});

describe("tree queries", () => {
  it("firstPanelsNode finds the side panels with its path", () => {
    const tree = seedLayout(["model"], ["tabs", "model"]);
    const found = firstPanelsNode(tree);
    expect(found?.path).toEqual([1]);
    expect(found?.node.panels.map((p) => p.view)).toEqual(["model"]);
  });

  it("firstCollapsibleNodeId returns the default tree's side node id", () => {
    expect(firstCollapsibleNodeId(DEFAULT_LAYOUT)).toBe("side");
  });

  it("firstCollapsibleNodeId falls back to a path key when the node has no id", () => {
    const tree: LayoutTree = {
      version: 1,
      root: {
        kind: "split",
        dir: "row",
        children: [
          { size: 1, node: { kind: "leaf", view: "chat" } },
          {
            size: 0,
            basis: 320,
            collapsible: true,
            node: { kind: "panels", panels: [{ kind: "leaf", view: "tabs" }] },
          },
        ],
      },
    };
    // The collapsible child sits at root path index 1 → key "1".
    expect(firstCollapsibleNodeId(tree)).toBe("1");
  });

  it("firstCollapsibleNodeId returns null when nothing is collapsible", () => {
    const tree: LayoutTree = {
      version: 1,
      root: {
        kind: "split",
        dir: "row",
        children: [{ size: 1, node: { kind: "leaf", view: "chat" } }],
      },
    };
    expect(firstCollapsibleNodeId(tree)).toBeNull();
  });
});
