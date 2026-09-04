import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@dispatch/layout-contract";
import {
  migrationTree,
  sidePanelViews,
  storedPanelViews,
} from "./migration";
import { overlaySidePanels } from "./seed";

const KNOWN = new Set(["tabs", "model", "extensions", "vision", "tasks"]);

describe("storedPanelViews", () => {
  it("parses a stored array of view ids, filtered to known views, order kept", () => {
    expect(storedPanelViews(["vision", "junk", "tasks"], KNOWN)).toEqual(["vision", "tasks"]);
  });

  it("returns null for absent/junk/non-array values", () => {
    expect(storedPanelViews(null, KNOWN)).toBeNull();
    expect(storedPanelViews(undefined, KNOWN)).toBeNull();
    expect(storedPanelViews("extensions", KNOWN)).toBeNull();
    expect(storedPanelViews({ 0: "tabs" }, KNOWN)).toBeNull();
  });

  it("returns null when nothing stored is a known view", () => {
    expect(storedPanelViews(["deleted-view", "another-gone"], KNOWN)).toBeNull();
    expect(storedPanelViews([], KNOWN)).toBeNull();
  });
});

describe("sidePanelViews", () => {
  it("reads the default tree's side panels", () => {
    expect(sidePanelViews(DEFAULT_LAYOUT)).toEqual(["tabs", "model"]);
  });

  it("returns null for a tree without a 'side' panels node", () => {
    expect(sidePanelViews({ version: 1, root: { kind: "leaf", view: "chat" } })).toBeNull();
  });
});

describe("migrationTree (§2.7 — one-way, best-effort)", () => {
  it("imports the stored selection when the fetched tree is the untouched default seed", () => {
    const stored = JSON.stringify(["extensions", "tasks"]);
    const migrated = migrationTree(JSON.parse(stored), KNOWN, DEFAULT_LAYOUT);
    expect(migrated).toEqual(overlaySidePanels(DEFAULT_LAYOUT, ["extensions", "tasks"]));
    // The rest of the tree is untouched — only the side panels changed.
    expect(migrated?.root).toEqual(
      overlaySidePanels(DEFAULT_LAYOUT, ["extensions", "tasks"])?.root,
    );
  });

  it("returns null when the key is absent / junk / has no known views (nothing to import)", () => {
    expect(migrationTree(null, KNOWN, DEFAULT_LAYOUT)).toBeNull();
    expect(migrationTree("junk", KNOWN, DEFAULT_LAYOUT)).toBeNull();
    expect(migrationTree(["gone-view"], KNOWN, DEFAULT_LAYOUT)).toBeNull();
  });

  it("returns null when the provider's tree is NOT the default seed (custom layout wins)", () => {
    const custom = overlaySidePanels(DEFAULT_LAYOUT, ["vision"]);
    expect(migrationTree(["extensions"], KNOWN, custom)).toBeNull();
  });

  it("returns null when the fetched tree has no side panels node at all", () => {
    expect(
      migrationTree(["extensions"], KNOWN, { version: 1, root: { kind: "leaf", view: "chat" } }),
    ).toBeNull();
  });

  it("a stored selection identical to the default still migrates (a harmless idempotent PUT)", () => {
    const migrated = migrationTree(["tabs", "model"], KNOWN, DEFAULT_LAYOUT);
    expect(migrated).toEqual(DEFAULT_LAYOUT);
  });
});
