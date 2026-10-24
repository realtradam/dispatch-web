import { describe, expect, it } from "vitest";
import { cardFlipId, forestFlipIds, groupFlipId, isGroupFlipId, leavingFlipIds } from "./tab-flip";
import { buildTabGroups } from "./tab-groups";
import type { Tab } from "./tabs";

function tab(id: string, parent?: string): Tab {
  return {
    conversationId: id,
    model: "m",
    title: id,
    workspaceId: "w",
    ...(parent !== undefined ? { tabGroupParentId: parent } : {}),
  };
}

describe("flip ids", () => {
  it("distinguishes a card from the group box of the same conversation", () => {
    expect(cardFlipId("p")).not.toBe(groupFlipId("p"));
    expect(isGroupFlipId(groupFlipId("p"))).toBe(true);
    expect(isGroupFlipId(cardFlipId("p"))).toBe(false);
  });
});

describe("forestFlipIds", () => {
  it("lists every card plus a box for each tab that has visible subagents", () => {
    const forest = buildTabGroups([tab("p"), tab("c", "p"), tab("g", "c"), tab("solo")]);
    expect([...forestFlipIds(forest)].sort()).toEqual(
      ["c", "g", "group:c", "group:p", "p", "solo"].sort(),
    );
  });

  it("has no boxes when nothing is grouped", () => {
    expect([...forestFlipIds(buildTabGroups([tab("a"), tab("b")]))]).toEqual(["a", "b"]);
  });
});

describe("leavingFlipIds", () => {
  it("returns the rendered ids the next render drops, in rendered order", () => {
    const before = buildTabGroups([tab("p"), tab("c", "p"), tab("solo")]);
    // Closing the only subagent drops its card AND the parent's group box.
    const after = buildTabGroups([tab("p"), tab("solo")]);
    expect(leavingFlipIds([...forestFlipIds(before)], forestFlipIds(after))).toEqual([
      "group:p",
      "c",
    ]);
  });

  it("is empty when a tab is only added", () => {
    const next = forestFlipIds(buildTabGroups([tab("a"), tab("b", "a")]));
    expect(leavingFlipIds(["a"], next)).toEqual([]);
  });
});
