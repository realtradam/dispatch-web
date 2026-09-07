import { describe, expect, it } from "vitest";
import type { LocalStore } from "../../adapters/local-storage";
import { geometryFor, type TileLayoutData, type TileLayoutEntry } from "./logic/tile-layout";
import { createTileLayoutStore } from "./tile-layout-store.svelte";

const WIDE = geometryFor(1920, 1080);

/** An in-memory `LocalStore` (the injected outermost edge — no mocks of our own modules). */
function memoryStore(initial: TileLayoutData | null = null): LocalStore<TileLayoutData> & {
  saved: TileLayoutData[];
} {
  let value = initial;
  const saved: TileLayoutData[] = [];
  return {
    saved,
    load: () => value,
    save(next: TileLayoutData) {
      saved.push(next);
      value = next;
    },
    clear() {
      value = null;
    },
  };
}

function tile(id: string, order: number, colSpan = 1, rowSpan = 1): TileLayoutEntry {
  return { id, order, colSpan, rowSpan };
}

describe("createTileLayoutStore", () => {
  it("loads the persisted document at creation (v1 migrates to v2 in memory)", () => {
    const persistence = memoryStore({ version: 1, tiles: [tile("a", 0, 2, 2)] });
    const store = createTileLayoutStore(persistence);
    expect(store.entries).toEqual([tile("a", 0, 2, 2)]);
  });

  it("loads a v2 document with anchors intact", () => {
    const persistence = memoryStore({
      version: 2,
      tiles: [{ ...tile("a", 0), col: 2, row: 3 }],
    });
    const store = createTileLayoutStore(persistence);
    expect(store.entries).toEqual([{ ...tile("a", 0), col: 2, row: 3 }]);
  });

  it("sanitizes a corrupt persisted document to empty", () => {
    const persistence = memoryStore(null);
    // The adapter's load is untyped at the boundary — simulate garbage.
    const store = createTileLayoutStore({
      load: () => ({ junk: true }) as unknown as TileLayoutData,
      save: () => {},
      clear: () => {},
    });
    expect(store.entries).toEqual([]);
    expect(persistence.saved).toEqual([]);
  });

  it("sync appends unknown workspaces and drops deleted ones, persisting once", () => {
    const persistence = memoryStore({ version: 1, tiles: [tile("a", 0), tile("gone", 1)] });
    const store = createTileLayoutStore(persistence);

    store.sync(["a", "b"]);

    expect(store.entries.map((t) => t.id)).toEqual(["a", "b"]);
    expect(persistence.saved).toHaveLength(1);
    // The max order counts KEPT entries (the dropped one doesn't reserve a slot).
    expect(persistence.saved[0]).toEqual({
      version: 2,
      tiles: [tile("a", 0), { id: "b", colSpan: 1, rowSpan: 1, order: 1 }],
    });
  });

  it("sync keeps pinned anchors (a deleted tile's cells become gaps)", () => {
    const persistence = memoryStore({
      version: 2,
      tiles: [
        { ...tile("a", 0), col: 1, row: 1 },
        { ...tile("gone", 1), col: 1, row: 2 },
      ],
    });
    const store = createTileLayoutStore(persistence);

    store.sync(["a"]);

    expect(store.entries).toEqual([{ ...tile("a", 0), col: 1, row: 1 }]);
  });

  it("sync is a no-op (no write) when the merge changes nothing", () => {
    const persistence = memoryStore({ version: 1, tiles: [tile("a", 0)] });
    const store = createTileLayoutStore(persistence);

    store.sync(["a"]);
    store.sync(["a"]);

    expect(persistence.saved).toHaveLength(0);
  });

  it("resize persists the new spans without clamping", () => {
    const persistence = memoryStore({ version: 1, tiles: [tile("a", 0)] });
    const store = createTileLayoutStore(persistence);

    store.resize("a", 4, 2);

    expect(store.entries).toEqual([tile("a", 0, 4, 2)]);
    expect(persistence.saved.at(-1)?.tiles).toEqual([tile("a", 0, 4, 2)]);
  });

  it("placeAtCell commits the displacement and pins EVERY tile", () => {
    const persistence = memoryStore({
      version: 1,
      tiles: [tile("a", 0), tile("b", 1)],
    });
    const store = createTileLayoutStore(persistence);

    // a@(1,1), b@(1,2) → drag a to (2,1): a pins there, b keeps its cell.
    store.placeAtCell("a", { col: 2, row: 1 }, WIDE);

    const entries = store.entries;
    expect(entries.find((t) => t.id === "a")).toMatchObject({ col: 2, row: 1 });
    expect(entries.find((t) => t.id === "b")).toMatchObject({ col: 1, row: 2 });
    // Written as v2.
    expect(persistence.saved.at(-1)?.version).toBe(2);
  });

  it("placeAtCell with an unknown id is a no-op (no write)", () => {
    const persistence = memoryStore({ version: 1, tiles: [tile("a", 0)] });
    const store = createTileLayoutStore(persistence);

    store.placeAtCell("nope", { col: 1, row: 1 }, WIDE);

    expect(persistence.saved).toHaveLength(0);
    expect(store.entries).toEqual([tile("a", 0)]);
  });

  it("placeFirstEmpty PINS the new id at the first empty slot", () => {
    const persistence = memoryStore({
      version: 1,
      tiles: [tile("a", 0, 1, 2), tile("b", 1)],
    });
    const store = createTileLayoutStore(persistence);

    store.placeFirstEmpty("new", WIDE);

    // a packs rows 1-2, b row 3 → the first empty slot is (col1,row4) → pinned.
    expect(store.entries.find((t) => t.id === "new")).toMatchObject({ col: 1, row: 4 });
    expect(persistence.saved.at(-1)?.tiles.map((t) => t.id)).toEqual(["a", "b", "new"]);
  });

  it("placeFirstEmpty is idempotent for an id sync already appended (the refresh race)", () => {
    const persistence = memoryStore({ version: 1, tiles: [tile("a", 0)] });
    const store = createTileLayoutStore(persistence);
    store.sync(["a", "x"]); // the refresh appended the new workspace (unpinned)

    store.placeFirstEmpty("x", WIDE);
    const pinned = store.entries;
    store.placeFirstEmpty("x", WIDE); // the create flow's re-call must be stable

    expect(store.entries).toEqual(pinned);
    expect(store.entries.filter((t) => t.id === "x")).toHaveLength(1);
    // x is PINNED at the first empty slot: a@(1,1) → (1,2).
    expect(store.entries.find((t) => t.id === "x")).toMatchObject({ col: 1, row: 2 });
  });

  it("sortByRecentActivity re-applies recent-activity order, CLEARs pins, persists", () => {
    const persistence = memoryStore({
      version: 2,
      tiles: [
        { ...tile("a", 0), col: 1, row: 1 },
        { ...tile("b", 1), col: 2, row: 3 },
      ],
    });
    const store = createTileLayoutStore(persistence);

    store.sortByRecentActivity(
      new Map([
        ["a", 10],
        ["b", 99],
      ]),
    );

    expect(store.entries.map((t) => t.id)).toEqual(["b", "a"]);
    expect(store.entries.every((t) => t.col === undefined && t.row === undefined)).toBe(true);
  });
});
