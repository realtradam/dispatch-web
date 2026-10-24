import { describe, expect, it } from "vitest";
import {
  buildTabGroups,
  cascadeCloseIds,
  directGroupChildren,
  groupBleedPx,
  groupDescendants,
  groupGutterPx,
  groupParentCandidates,
  groupTone,
  lastRowIsGroup,
  visibleGroupParents,
} from "./tab-groups";
import type { Tab } from "./tabs";

function tab(id: string, parent?: string): Tab {
  return {
    conversationId: id,
    model: "m",
    title: id.toUpperCase(),
    workspaceId: "w",
    ...(parent !== undefined ? { tabGroupParentId: parent } : {}),
  };
}

const ids = (tabs: readonly Tab[]): string[] => tabs.map((t) => t.conversationId);

describe("visibleGroupParents", () => {
  it("keeps a parent that is another open tab", () => {
    const parents = visibleGroupParents([tab("a"), tab("b", "a")]);
    expect(parents.get("a")).toBeNull();
    expect(parents.get("b")).toBe("a");
  });

  it("drops a parent that is not open (closed / other workspace) or is the tab itself", () => {
    const parents = visibleGroupParents([tab("a", "gone"), tab("b", "b")]);
    expect(parents.get("a")).toBeNull();
    expect(parents.get("b")).toBeNull();
  });

  it("treats every member of a cycle as a root, but keeps hangers-on below them", () => {
    const parents = visibleGroupParents([tab("a", "b"), tab("b", "a"), tab("c", "a")]);
    expect(parents.get("a")).toBeNull();
    expect(parents.get("b")).toBeNull();
    expect(parents.get("c")).toBe("a");
  });
});

describe("buildTabGroups", () => {
  it("returns flat roots and depth 0 when nothing is grouped", () => {
    const forest = buildTabGroups([tab("a"), tab("b"), tab("c")]);
    expect(forest.maxDepth).toBe(0);
    expect(forest.roots.map((n) => n.tab.conversationId)).toEqual(["a", "b", "c"]);
    expect(forest.roots.every((n) => n.children.length === 0)).toBe(true);
  });

  it("nests children under their parent in tab order, preserving root order", () => {
    // Child listed BEFORE its parent still nests under it.
    const forest = buildTabGroups([tab("x", "p"), tab("a"), tab("p"), tab("y", "p")]);
    expect(forest.maxDepth).toBe(1);
    expect(forest.roots.map((n) => n.tab.conversationId)).toEqual(["a", "p"]);
    const p = forest.roots[1];
    expect(p?.children.map((n) => n.tab.conversationId)).toEqual(["x", "y"]);
  });

  it("supports nested groups (subagents with subagents) and reports the depth", () => {
    const forest = buildTabGroups([tab("p"), tab("c", "p"), tab("g", "c"), tab("gg", "g")]);
    expect(forest.maxDepth).toBe(3);
    const c = forest.roots[0]?.children[0];
    expect(c?.tab.conversationId).toBe("c");
    expect(c?.children[0]?.children[0]?.tab.conversationId).toBe("gg");
  });

  it("renders every tab exactly once", () => {
    const tabs = [tab("a", "b"), tab("b", "a"), tab("c", "a"), tab("d", "nope"), tab("e", "c")];
    const seen: string[] = [];
    const walk = (nodes: ReturnType<typeof buildTabGroups>["roots"]): void => {
      for (const n of nodes) {
        seen.push(n.tab.conversationId);
        walk(n.children);
      }
    };
    walk(buildTabGroups(tabs).roots);
    expect(seen.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("groupDescendants / directGroupChildren / groupParentCandidates", () => {
  const tabs = [tab("p"), tab("c1", "p"), tab("c2", "p"), tab("g", "c1"), tab("solo")];

  it("collects transitive descendants", () => {
    expect([...groupDescendants(tabs, "p")].sort()).toEqual(["c1", "c2", "g"]);
    expect([...groupDescendants(tabs, "c1")]).toEqual(["g"]);
    expect(groupDescendants(tabs, "solo").size).toBe(0);
  });

  it("lists direct children only", () => {
    expect(directGroupChildren(tabs, "p")).toEqual(["c1", "c2"]);
  });

  it("offers every tab except self, descendants (cycle) and the current parent", () => {
    expect(ids(groupParentCandidates(tabs, "c1"))).toEqual(["c2", "solo"]);
    expect(ids(groupParentCandidates(tabs, "p"))).toEqual(["solo"]);
    expect(ids(groupParentCandidates(tabs, "solo"))).toEqual(["p", "c1", "c2", "g"]);
  });
});

describe("cascadeCloseIds (the ids a cascading tab close removes)", () => {
  const tabs = [
    tab("p"),
    tab("c1", "p"),
    tab("c2", "p"),
    tab("g", "c1"), // sub-sub-agent: grouped under c1, still cascades from p
    tab("solo"),
  ];

  it("returns the tab first, then its transitive descendants in tab order", () => {
    expect(cascadeCloseIds(tabs, "p")).toEqual(["p", "c1", "c2", "g"]);
  });

  it("starts the cascade at a mid-level tab, taking only its own subtree", () => {
    expect(cascadeCloseIds(tabs, "c1")).toEqual(["c1", "g"]);
  });

  it("returns just the tab itself when it has no subagents (closes without a prompt)", () => {
    expect(cascadeCloseIds(tabs, "solo")).toEqual(["solo"]);
    expect(cascadeCloseIds(tabs, "c2")).toEqual(["c2"]);
  });

  it("ignores tabs whose group parent is no longer open", () => {
    const stale = [tab("p"), tab("orphan", "gone")];
    expect(cascadeCloseIds(stale, "p")).toEqual(["p"]);
  });
});

describe("groupTone", () => {
  it("rotates three colours by level, starting at the outermost box", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(groupTone)).toEqual([
      "secondary",
      "success",
      "accent",
      "secondary",
      "success",
      "accent",
      "secondary",
    ]);
  });

  it("never gives a box the colour of its parent or grandparent", () => {
    for (let level = 3; level <= 20; level++) {
      expect(groupTone(level)).not.toBe(groupTone(level - 1));
      expect(groupTone(level)).not.toBe(groupTone(level - 2));
    }
  });

  it("never uses primary (reserved for the active tab)", () => {
    for (let level = 1; level <= 6; level++) expect(groupTone(level)).not.toBe("primary");
  });

  it("stays in range for out-of-range levels", () => {
    expect(groupTone(0)).toBe("accent");
    expect(groupTone(-1)).toBe("success");
  });
});

describe("groupBleedPx / groupGutterPx", () => {
  it("is zero without groups", () => {
    expect(groupGutterPx(0)).toBe(0);
    expect(groupBleedPx(1, 0)).toBe(0);
  });

  it("bleeds outer boxes further than inner ones, the outermost filling the gutter", () => {
    const max = 3;
    const bleeds = [1, 2, 3].map((l) => groupBleedPx(l, max));
    expect(bleeds[0]).toBe(groupGutterPx(max));
    expect(bleeds[0]).toBeGreaterThan(bleeds[1] ?? 0);
    expect(bleeds[1]).toBeGreaterThan(bleeds[2] ?? 0);
    expect(bleeds[2]).toBeGreaterThan(0);
  });

  it("keeps the gutter bounded for deep nesting", () => {
    expect(groupGutterPx(12)).toBeLessThanOrEqual(24);
    expect(groupBleedPx(12, 12)).toBeGreaterThan(0);
  });
});

describe("lastRowIsGroup (mirrors grid row-dense placement)", () => {
  const leaf = (id: string) => ({ tab: tab(id), children: [] });
  const group = (id: string) => ({ tab: tab(id), children: [leaf(`${id}-kid`)] });

  it("is false with only cards", () => {
    expect(lastRowIsGroup([])).toBe(false);
    expect(lastRowIsGroup([leaf("a"), leaf("b"), leaf("c")])).toBe(false);
  });

  it("is true when a nested group comes last", () => {
    expect(lastRowIsGroup([leaf("a"), group("g")])).toBe(true);
    expect(lastRowIsGroup([group("g")])).toBe(true);
  });

  it("stays true when a later card back-fills an earlier half row", () => {
    // [a, _] then [g, g]; b fills a's half row → g is still the last row.
    expect(lastRowIsGroup([leaf("a"), group("g"), leaf("b")])).toBe(true);
  });

  it("is false when a later card has to open a new row below the group", () => {
    expect(lastRowIsGroup([group("g"), leaf("a")])).toBe(false);
    expect(lastRowIsGroup([leaf("a"), leaf("b"), group("g"), leaf("c")])).toBe(false);
  });
});
