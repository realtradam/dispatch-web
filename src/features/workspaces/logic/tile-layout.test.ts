import { describe, expect, it } from "vitest";
import {
  clampSpan,
  fillOrderKey,
  firstEmptySlot,
  type GridGeometry,
  geometryFor,
  insertAtFirstEmptySlot,
  mergeLayout,
  moveTile,
  pack,
  resizeTile,
  sanitizeLayout,
  sortByRecentActivity,
  type TileLayoutEntry,
} from "./tile-layout";

const WIDE = geometryFor(1920, 1080);
const TALL = geometryFor(390, 844);

function tile(id: string, order: number, colSpan = 1, rowSpan = 1): TileLayoutEntry {
  return { id, order, colSpan, rowSpan };
}

describe("geometryFor", () => {
  it("resolves landscape/desktop viewports to the WIDE geometry", () => {
    const geometry = geometryFor(1920, 1080);
    expect(geometry.mode).toBe("wide");
    expect(geometry.flowRows).toBe(4);
    expect(geometry.flowCols).toBe(0);
    expect(geometry.maxColSpan).toBe(4);
    expect(geometry.maxRowSpan).toBe(2);
    expect(geometry.unit.height).toBeGreaterThan(0);
    expect(geometry.unit.width).toBeGreaterThan(0);
  });

  it("resolves portrait/mobile viewports to the TALL geometry", () => {
    const geometry = geometryFor(390, 844);
    expect(geometry.mode).toBe("tall");
    expect(geometry.flowCols).toBe(2);
    expect(geometry.flowRows).toBe(0);
    expect(geometry.maxColSpan).toBe(2);
    expect(geometry.maxRowSpan).toBe(2);
  });

  it("picks the picker dimensions from the span caps (4×2 wide, 2×2 tall)", () => {
    // The resize picker IS the span cap: cols × rows of small squares.
    expect([WIDE.maxColSpan, WIDE.maxRowSpan]).toEqual([4, 2]);
    expect([TALL.maxColSpan, TALL.maxRowSpan]).toEqual([2, 2]);
  });

  it("resolves degenerate (unmeasured) sizes to wide", () => {
    expect(geometryFor(0, 0).mode).toBe("wide");
  });

  it("derives the wide unit from the canvas height so the 4 rows fill it", () => {
    // 4·unit + 3·gap + 2·margin ≈ height: an 800px canvas gets ~160px tiles,
    // NOT the old fixed 120px (the "squares are so small" complaint).
    const geometry = geometryFor(1440, 800);
    const filled = 4 * geometry.unit.height + 3 * geometry.unit.gap + 2 * geometry.margin;
    expect(geometry.unit.height).toBeGreaterThanOrEqual(140);
    expect(Math.abs(filled - 800)).toBeLessThanOrEqual(8);
    expect(geometry.unit.width).toBe(geometry.unit.height);
  });

  it("clamps the wide unit to its band on very short and very tall canvases", () => {
    const short = geometryFor(1200, 300);
    const huge = geometryFor(5000, 4000); // wide (width ≥ height) with a huge height
    expect(short.unit.height).toBe(112);
    expect(huge.unit.height).toBe(184);
    // The margin never collapses (the "no margins" complaint) nor dominates.
    expect(short.margin).toBeGreaterThanOrEqual(24);
    expect(huge.margin).toBeLessThanOrEqual(64);
  });

  it("always carries a positive margin (the tile field never hugs the edge)", () => {
    const sizes: [number, number][] = [
      [1920, 1080],
      [390, 844],
      [0, 0],
      [1200, 300],
    ];
    for (const [w, h] of sizes) {
      expect(geometryFor(w, h).margin).toBeGreaterThan(0);
    }
  });

  it("keeps the tall unit fixed with a gap (its columns are fluid)", () => {
    expect(TALL.unit.width).toBe(0);
    expect(TALL.unit.height).toBeGreaterThanOrEqual(120);
    expect(TALL.unit.gap).toBeGreaterThan(8);
  });
});

describe("clampSpan", () => {
  it("clamps spans to the geometry caps", () => {
    expect(clampSpan({ colSpan: 4, rowSpan: 2 }, WIDE)).toEqual({ colSpan: 4, rowSpan: 2 });
    expect(clampSpan({ colSpan: 9, rowSpan: 9 }, WIDE)).toEqual({ colSpan: 4, rowSpan: 2 });
    expect(clampSpan({ colSpan: 3, rowSpan: 1 }, TALL)).toEqual({ colSpan: 2, rowSpan: 1 });
  });

  it("coerces garbage spans to 1×1", () => {
    expect(clampSpan({ colSpan: 0, rowSpan: -2 }, WIDE)).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(clampSpan({ colSpan: Number.NaN, rowSpan: 1.9 }, WIDE)).toEqual({
      colSpan: 1,
      rowSpan: 1,
    });
  });
});

describe("pack", () => {
  it("places tiles in order at the first fitting slot (wide, column-wise flow)", () => {
    const placements = pack([tile("a", 0), tile("b", 1), tile("c", 2), tile("d", 3)], WIDE);
    expect(placements).toEqual([
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "b", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
      { id: "c", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
      { id: "d", col: 1, row: 4, colSpan: 1, rowSpan: 1 },
    ]);
  });

  it("flows to the next column when the current one is full (wide)", () => {
    const placements = pack(
      [tile("a", 0), tile("b", 1), tile("c", 2), tile("d", 3), tile("e", 4)],
      WIDE,
    );
    expect(placements.map((p) => [p.col, p.row])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 1],
    ]);
  });

  it("respects the persisted order over ids", () => {
    const placements = pack([tile("z", 0), tile("a", 1)], WIDE);
    expect(placements.map((p) => p.id)).toEqual(["z", "a"]);
  });

  it("places a double-height tile at the first slot with room (wide)", () => {
    const placements = pack([tile("a", 0, 1, 2), tile("b", 1), tile("c", 2)], WIDE);
    expect(placements.map((p) => [p.id, p.col, p.row, p.rowSpan])).toEqual([
      ["a", 1, 1, 2],
      ["b", 1, 3, 1],
      ["c", 1, 4, 1],
    ]);
  });

  it("a tile too tall for the remaining rows moves to the next column (wide)", () => {
    // a,b,c fill rows 1-3; a 2-row tile does not fit the single remaining row → col 2.
    const placements = pack(
      [tile("a", 0), tile("b", 1), tile("c", 2), tile("tall", 3, 1, 2)],
      WIDE,
    );
    expect(placements[3]).toEqual({ id: "tall", col: 2, row: 1, colSpan: 1, rowSpan: 2 });
  });

  it("flows row-wise across two fixed columns in tall mode", () => {
    const placements = pack([tile("a", 0), tile("b", 1), tile("c", 2)], TALL);
    expect(placements.map((p) => [p.col, p.row])).toEqual([
      [1, 1],
      [2, 1],
      [1, 2],
    ]);
  });

  it("clamps spans per geometry when packing (persisted spans stay raw)", () => {
    const tiles = [tile("wide", 0, 3, 1), tile("b", 1, 4, 2)];
    const placements = pack(tiles, TALL);
    expect(placements).toEqual([
      { id: "wide", col: 1, row: 1, colSpan: 2, rowSpan: 1 },
      { id: "b", col: 1, row: 2, colSpan: 2, rowSpan: 2 },
    ]);
    // The input is untouched.
    expect(tiles[0]).toEqual({ id: "wide", order: 0, colSpan: 3, rowSpan: 1 });
  });

  it("never overlaps tiles", () => {
    const tiles = [
      tile("a", 0, 2, 2),
      tile("b", 1, 2, 2),
      tile("c", 2, 4, 1),
      tile("d", 3),
      tile("e", 4, 1, 2),
      tile("f", 5),
    ];
    const placements = pack(tiles, WIDE);
    const seen = new Set<string>();
    for (const p of placements) {
      for (let r = p.row; r < p.row + p.rowSpan; r++) {
        for (let c = p.col; c < p.col + p.colSpan; c++) {
          const key = `${r}:${c}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });
});

describe("fillOrderKey", () => {
  it("ranks wide slots column-wise (top-to-bottom, then next column)", () => {
    expect(fillOrderKey(1, 1, WIDE)).toBeLessThan(fillOrderKey(1, 2, WIDE));
    expect(fillOrderKey(1, 4, WIDE)).toBeLessThan(fillOrderKey(2, 1, WIDE));
  });

  it("ranks tall slots row-wise (left-to-right, then next row)", () => {
    expect(fillOrderKey(1, 1, TALL)).toBeLessThan(fillOrderKey(2, 1, TALL));
    expect(fillOrderKey(2, 1, TALL)).toBeLessThan(fillOrderKey(1, 2, TALL));
  });
});

describe("firstEmptySlot", () => {
  it("finds the first fitting empty slot in fill order", () => {
    // Wide, rows 1-2 of col 1 occupied by a double-height tile → first empty is (col1,row3).
    const tiles = [tile("a", 0, 1, 2)];
    expect(firstEmptySlot(tiles, { colSpan: 1, rowSpan: 1 }, WIDE)).toEqual({ col: 1, row: 3 });
  });

  it("skips slots too small for the requested footprint", () => {
    // (col1,row4) is the first empty 1×1 slot after three singles, but a
    // 2-row tile needs rows 4-5 of a 4-row grid — impossible → next column.
    const tiles = [tile("a", 0), tile("b", 1), tile("c", 2)];
    expect(firstEmptySlot(tiles, { colSpan: 1, rowSpan: 1 }, WIDE)).toEqual({ col: 1, row: 4 });
    expect(firstEmptySlot(tiles, { colSpan: 1, rowSpan: 2 }, WIDE)).toEqual({ col: 2, row: 1 });
  });

  it("returns the origin for an empty layout", () => {
    expect(firstEmptySlot([], { colSpan: 1, rowSpan: 1 }, WIDE)).toEqual({ col: 1, row: 1 });
  });

  it("lands in a brand-new column/row beyond the occupied extent", () => {
    // Two 4×2 tiles fill columns 1-4 across all 4 rows → the next slot is col 5.
    const tiles = [tile("a", 0, 4, 2), tile("b", 1, 4, 2)];
    expect(firstEmptySlot(tiles, { colSpan: 1, rowSpan: 1 }, WIDE)).toEqual({ col: 5, row: 1 });
  });
});

describe("insertAtFirstEmptySlot", () => {
  it("inserts a new tile so it packs into the first empty slot", () => {
    // A double-height tile fills rows 1-2, a single fills row 3 → the first
    // empty slot is (col1,row4); the new tile must land exactly there.
    const tiles = [tile("big", 0, 1, 2), tile("c", 1)];
    const next = insertAtFirstEmptySlot(tiles, "new", WIDE);
    expect(next.map((t) => t.id)).toEqual(["big", "c", "new"]);
    const placements = pack(next, WIDE);
    expect(placements.map((p) => [p.id, p.col, p.row])).toEqual([
      ["big", 1, 1],
      ["c", 1, 3],
      ["new", 1, 4],
    ]);
  });

  it("renumbers orders densely after the insert", () => {
    const next = insertAtFirstEmptySlot([tile("a", 0, 1, 2), tile("b", 7)], "new", WIDE);
    expect(next.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it("moves an already-present tile instead of duplicating (refresh-race idempotency)", () => {
    const tiles = [tile("a", 0), tile("x", 1), tile("b", 2, 1, 2)];
    const first = insertAtFirstEmptySlot(tiles, "x", WIDE);
    const second = insertAtFirstEmptySlot(first, "x", WIDE);
    expect(second).toEqual(first);
    expect(second.filter((t) => t.id === "x")).toHaveLength(1);
  });

  it("appends when the empty slot is beyond the current extent", () => {
    const tiles = [tile("a", 0), tile("b", 1), tile("c", 2), tile("d", 3)];
    const next = insertAtFirstEmptySlot(tiles, "e", WIDE);
    expect(next.map((t) => t.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(pack(next, WIDE).at(-1)).toMatchObject({ id: "e", col: 2, row: 1 });
  });

  it("preserves the spans of a moved existing tile", () => {
    const tiles = [tile("x", 0, 2, 2), tile("a", 1), tile("b", 2), tile("c", 3)];
    const next = insertAtFirstEmptySlot(tiles, "x", WIDE);
    expect(next.find((t) => t.id === "x")).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });
});

describe("resizeTile", () => {
  it("sets the persisted spans of one tile", () => {
    const next = resizeTile([tile("a", 0), tile("b", 1)], "b", 4, 2);
    expect(next.find((t) => t.id === "b")).toMatchObject({ colSpan: 4, rowSpan: 2 });
    expect(next.find((t) => t.id === "a")).toMatchObject({ colSpan: 1, rowSpan: 1 });
  });

  it("sanitizes garbage spans to 1 and preserves order", () => {
    const next = resizeTile([tile("a", 5, 2, 2)], "a", Number.NaN, -3);
    expect(next).toEqual([{ id: "a", order: 5, colSpan: 1, rowSpan: 1 }]);
  });

  it("ignores unknown ids", () => {
    const tiles = [tile("a", 0)];
    expect(resizeTile(tiles, "nope", 2, 2)).toEqual(tiles);
  });

  it("does NOT clamp to the current geometry (render-time concern)", () => {
    // A 4-wide desktop tile resized while wide stays 4-wide in the document;
    // tall rendering clamps its VIEW.
    const next = resizeTile([tile("a", 0)], "a", 4, 2);
    expect(next[0]).toMatchObject({ colSpan: 4, rowSpan: 2 });
  });
});

describe("moveTile", () => {
  it("moves a tile forward, landing after the hovered tile", () => {
    const next = moveTile([tile("a", 0), tile("b", 1), tile("c", 2), tile("d", 3)], "a", 2);
    expect(next.map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a tile backward, landing before the hovered tile", () => {
    const next = moveTile([tile("a", 0), tile("b", 1), tile("c", 2), tile("d", 3)], "d", 1);
    expect(next.map((t) => t.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("renumbers orders densely", () => {
    const next = moveTile([tile("a", 0), tile("b", 3), tile("c", 9)], "c", 0);
    expect(next.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it("is a no-op for the same index or an unknown id", () => {
    const tiles = [tile("a", 0), tile("b", 1)];
    expect(moveTile(tiles, "a", 0)).toEqual(tiles);
    expect(moveTile(tiles, "x", 1)).toEqual(tiles);
  });

  it("clamps out-of-range indices", () => {
    const next = moveTile([tile("a", 0), tile("b", 1)], "a", 99);
    expect(next.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("sortByRecentActivity", () => {
  it("re-applies the recent-activity order (descending)", () => {
    const tiles = [tile("a", 0), tile("b", 1), tile("c", 2)];
    const next = sortByRecentActivity(
      tiles,
      new Map([
        ["a", 100],
        ["b", 300],
        ["c", 200],
      ]),
    );
    expect(next.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("treats unknown ids as least-recent and renumbers", () => {
    const tiles = [tile("a", 0), tile("b", 1)];
    // `a` has recent activity (50); `b` is unknown → least-recent → last.
    const next = sortByRecentActivity(tiles, new Map([["a", 50]]));
    expect(next.map((t) => [t.id, t.order])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });
});

describe("mergeLayout", () => {
  it("starts workspaces unknown to the layout (appends after the max order)", () => {
    const merged = mergeLayout({ version: 1, tiles: [tile("a", 0)] }, ["a", "b", "c"]);
    expect(merged.map((t) => [t.id, t.order])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("appends unknowns in the live list's order", () => {
    const merged = mergeLayout({ version: 1, tiles: [tile("z", 0)] }, ["z", "y", "x"]);
    expect(merged.map((t) => t.id)).toEqual(["z", "y", "x"]);
  });

  it("drops entries for deleted workspaces", () => {
    const merged = mergeLayout(
      { version: 1, tiles: [tile("a", 0), tile("gone", 1), tile("b", 2)] },
      ["a", "b"],
    );
    expect(merged.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("keeps manual order (not the list order) for known workspaces", () => {
    const merged = mergeLayout({ version: 1, tiles: [tile("c", 0), tile("a", 1)] }, ["a", "c"]);
    expect(merged.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("clamps spans in the view when a geometry is given (persisted data unchanged)", () => {
    const merged = mergeLayout({ version: 1, tiles: [tile("a", 0, 3, 1)] }, ["a"], TALL);
    expect(merged[0]).toMatchObject({ colSpan: 2, rowSpan: 1 });
    expect(mergeLayout({ version: 1, tiles: [tile("a", 0, 3, 1)] }, ["a"])).toEqual([
      { id: "a", order: 0, colSpan: 3, rowSpan: 1 },
    ]);
  });

  it("deduplicates corrupted duplicate ids (first by order wins)", () => {
    const merged = mergeLayout({ version: 1, tiles: [tile("a", 1, 2, 2), tile("a", 0)] }, [
      "a",
      "b",
    ]);
    expect(merged).toEqual([
      { id: "a", order: 0, colSpan: 1, rowSpan: 1 },
      { id: "b", order: 1, colSpan: 1, rowSpan: 1 },
    ]);
  });

  it("handles a null/undefined persisted document", () => {
    expect(mergeLayout(null, ["a"])).toEqual([{ id: "a", colSpan: 1, rowSpan: 1, order: 1 }]);
    expect(mergeLayout(undefined, [])).toEqual([]);
  });
});

describe("sanitizeLayout", () => {
  it("accepts a valid document", () => {
    expect(
      sanitizeLayout({ version: 1, tiles: [{ id: "a", colSpan: 2, rowSpan: 1, order: 0 }] }),
    ).toEqual({
      version: 1,
      tiles: [{ id: "a", colSpan: 2, rowSpan: 1, order: 0 }],
    });
  });

  it("rejects foreign versions and malformed documents", () => {
    expect(sanitizeLayout(null)).toEqual({ version: 1, tiles: [] });
    expect(sanitizeLayout("nope")).toEqual({ version: 1, tiles: [] });
    expect(sanitizeLayout({ version: 2, tiles: [] })).toEqual({ version: 1, tiles: [] });
    expect(sanitizeLayout({ version: 1, tiles: "x" })).toEqual({ version: 1, tiles: [] });
  });

  it("coerces malformed entries and drops anonymous/duplicate ones", () => {
    const data = sanitizeLayout({
      version: 1,
      tiles: [
        { id: "a", colSpan: "x", rowSpan: 0, order: "y" },
        null,
        { colSpan: 2 },
        { id: "a", order: 9 },
        { id: "b", colSpan: 3.9, order: 2.5 },
      ],
    });
    expect(data.tiles).toEqual([
      { id: "a", colSpan: 1, rowSpan: 1, order: 0 },
      { id: "b", colSpan: 3, rowSpan: 1, order: 2 },
    ]);
  });
});

describe("geometry-agnostic persistence", () => {
  it("the SAME persisted data renders in either geometry (positions re-derived, never stored)", () => {
    const tiles: TileLayoutEntry[] = [
      tile("a", 0, 4, 2),
      tile("b", 1),
      tile("c", 2),
      tile("d", 3, 2, 2),
      tile("e", 4),
    ];
    const widePlacements = pack(tiles, WIDE);
    const tallPlacements = pack(tiles, TALL);
    // Wide flows column-wise across 4 rows; tall flows row-wise across 2 columns.
    expect(widePlacements[0]).toMatchObject({ id: "a", col: 1, row: 1, colSpan: 4, rowSpan: 2 });
    expect(widePlacements.at(-1)).toMatchObject({ id: "e" });
    expect(tallPlacements[0]).toMatchObject({ id: "a", col: 1, row: 1, colSpan: 2, rowSpan: 2 });
    // The document carries NO orientation/position field — only id/spans/order.
    expect(Object.keys(tiles[0] ?? {}).sort()).toEqual(["colSpan", "id", "order", "rowSpan"]);
  });
});

describe("type surface", () => {
  it("exposes the geometry fields the picker and grid need", () => {
    // A 500px-tall canvas: the raw unit (100) clamps UP to the 112px minimum,
    // so the gap is 12px and the margin 37px (never the old fixed 8px gap).
    const geometry: GridGeometry = geometryFor(1000, 500);
    expect([
      geometry.mode,
      geometry.flowRows,
      geometry.flowCols,
      geometry.unit.gap,
      geometry.margin,
    ]).toEqual(["wide", 4, 0, 12, 37]);
  });
});
