import { describe, expect, it } from "vitest";
import {
  clampSpan,
  displacePlace,
  dragAppendLimit,
  fillOrderKey,
  firstEmptySlot,
  type GridGeometry,
  geometryFor,
  mergeLayout,
  type Placement,
  pack,
  pinAtFirstEmpty,
  placeAtCell,
  resizeTile,
  sanitizeLayout,
  sortByRecentActivity,
  type TileLayoutEntry,
  toRenderCell,
  toUniversalCell,
  UNIVERSAL_ROWS,
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

describe("pinAtFirstEmpty", () => {
  it("pins a new tile at the first empty slot (holes count)", () => {
    // A double-height tile fills rows 1-2, a single fills row 3 → the first
    // empty slot is (col1,row4); the new tile PINS exactly there.
    const tiles = [tile("big", 0, 1, 2), tile("c", 1)];
    const next = pinAtFirstEmpty(tiles, "new", WIDE);
    expect(next.find((t) => t.id === "new")).toMatchObject({ col: 1, row: 4 });
    const placements = pack(next, WIDE);
    expect(placements.map((p) => [p.id, p.col, p.row])).toEqual([
      ["big", 1, 1],
      ["c", 1, 3],
      ["new", 1, 4],
    ]);
  });

  it("pins into a GAP between pinned tiles", () => {
    // big is pinned out of the way; the flow left row 3 free for a 1×1.
    const tiles = [
      { ...tile("big", 0, 1, 2), col: 1, row: 1 },
      { ...tile("z", 1), col: 1, row: 4 },
    ];
    const next = pinAtFirstEmpty(tiles, "new", WIDE);
    expect(next.find((t) => t.id === "new")).toMatchObject({ col: 1, row: 3 });
  });

  it("re-pins an already-present tile instead of duplicating (refresh-race idempotency)", () => {
    const tiles = [tile("a", 0), tile("x", 1), tile("b", 2, 1, 2)];
    const first = pinAtFirstEmpty(tiles, "x", WIDE);
    const second = pinAtFirstEmpty(first, "x", WIDE);
    expect(second).toEqual(first);
    expect(second.filter((t) => t.id === "x")).toHaveLength(1);
  });

  it("appends (pins beyond the current extent) when the grid is full", () => {
    const tiles = [tile("a", 0), tile("b", 1), tile("c", 2), tile("d", 3)];
    const next = pinAtFirstEmpty(tiles, "e", WIDE);
    expect(next.find((t) => t.id === "e")).toMatchObject({ col: 2, row: 1 });
  });

  it("preserves the spans of a re-pinned existing tile", () => {
    const tiles = [tile("x", 0, 2, 2), tile("a", 1), tile("b", 2), tile("c", 3)];
    const next = pinAtFirstEmpty(tiles, "x", WIDE);
    expect(next.find((t) => t.id === "x")).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });

  it("saves the pin in the universal frame (tall)", () => {
    const tiles = [{ ...tile("a", 0), col: 1, row: 1 }];
    const next = pinAtFirstEmpty(tiles, "new", TALL);
    // a renders at tall (1,1); the first empty slot is tall (2,1) → universal
    // (col 1, row 2).
    expect(next.find((t) => t.id === "new")).toMatchObject({ col: 1, row: 2 });
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

describe("displacePlace", () => {
  /** Render placements as the column-1 stream (cells 1..n, `_` = empty,
   *  one character per tile — the id's first char). */
  const stream = (placements: Placement[], geometry: GridGeometry): string => {
    const cells = new Map<number, string>();
    for (const p of placements) {
      for (let r = p.row; r < p.row + p.rowSpan; r++) {
        for (let c = p.col; c < p.col + p.colSpan; c++) {
          cells.set(fillOrderKey(c, r, geometry), p.id.charAt(0));
        }
      }
    }
    const maxKey = Math.max(0, ...cells.keys());
    const out: string[] = [];
    for (let key = 0; key <= maxKey; key++) {
      out.push(cells.get(key) ?? "_");
    }
    return out.join("");
  };

  it("USER EXAMPLE 1: X_X + Y placed in slot 1 → YXX (the gap absorbs the shift)", () => {
    // X at cells 1,3 (wide: (1,1) and (1,3)); Y sits at cell 5 (dragged in
    // from outside the shown range — its origin is beyond the gap).
    const placements: Placement[] = [
      { id: "X", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "X2", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
      { id: "Y", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ];
    const next = displacePlace(placements, "Y", { col: 1, row: 1 }, WIDE);
    // Y@1; X (was@1) pushed into the gap at 2; X2 (was@3) stays. The array
    // keeps the INPUT render order (only coordinates change).
    expect(next.map((p) => [p.id, p.col, p.row])).toEqual([
      ["X", 1, 2],
      ["X2", 1, 3],
      ["Y", 1, 1],
    ]);
  });

  it("USER EXAMPLE 2: _XZ_ + Y placed in slot 2 → _YXZ (leading gap preserved)", () => {
    // X@(1,2), Z@(1,3); Y dragged in from cell 5.
    const placements: Placement[] = [
      { id: "X", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
      { id: "Z", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
      { id: "Y", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ];
    const next = displacePlace(placements, "Y", { col: 1, row: 2 }, WIDE);
    // Same coordinates, input render order: X, Z, then the dragged Y.
    expect(next.map((p) => [p.id, p.col, p.row])).toEqual([
      ["X", 1, 3],
      ["Z", 1, 4],
      ["Y", 1, 2],
    ]);
  });

  it("dragging a tile OUT opens a gap at its old anchor (nothing slides back)", () => {
    const placements: Placement[] = [
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "b", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
    ];
    // Drag a (cell 1) to cell 3 — b stays at 2; a lands at 3.
    const next = displacePlace(placements, "a", { col: 1, row: 3 }, WIDE);
    // The array keeps the input render order (a first) — only a's coords move.
    expect(next.map((p) => [p.id, p.col, p.row])).toEqual([
      ["a", 1, 3],
      ["b", 1, 2],
    ]);
  });

  it("internal move rightward over a full run pushes the tail forward", () => {
    // a,b,c in cells 1-3; drag a to cell 2: b→3 pushes c→4.
    const placements: Placement[] = [
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "b", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
      { id: "c", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
    ];
    const next = displacePlace(placements, "a", { col: 1, row: 2 }, WIDE);
    expect(next.map((p) => [p.id, p.col, p.row])).toEqual([
      ["a", 1, 2],
      ["b", 1, 3],
      ["c", 1, 4],
    ]);
  });

  it("an unknown dragged id changes nothing (a copy of the input)", () => {
    const placements: Placement[] = [{ id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 }];
    const next = displacePlace(placements, "nope", { col: 1, row: 2 }, WIDE);
    expect(next).toEqual(placements);
  });

  it("a spanned displaced tile keeps its spans and re-anchors forward as a rect", () => {
    // big (2-tall) at rows 1-2; tail (2-tall) at rows 3-4. Drag big to (1,2):
    // its own old body is free-ish but (1,2)+(1,3) collides with tail's
    // (1,3)+(1,4) → tail re-anchors FORWARD: no 2-tall slot fits in column 1
    // anymore → column 2.
    const placements: Placement[] = [
      { id: "big", col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      { id: "tail", col: 1, row: 3, colSpan: 1, rowSpan: 2 },
    ];
    const next = displacePlace(placements, "big", { col: 1, row: 2 }, WIDE);
    expect(next.map((p) => [p.id, p.col, p.row, p.rowSpan])).toEqual([
      ["big", 1, 2, 2],
      ["tail", 2, 1, 2],
    ]);
  });

  it("displacing into the NEXT COLUMN when the column is full", () => {
    // 4 tiles fill column 1; drag the first to the LAST cell of column 1.
    const placements: Placement[] = [
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "b", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
      { id: "c", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
      { id: "d", col: 1, row: 4, colSpan: 1, rowSpan: 1 },
    ];
    const next = displacePlace(placements, "a", { col: 1, row: 4 }, WIDE);
    // d is pushed past the column's end → column 2 row 1. The array keeps the
    // INPUT render order (a,b,c,d) — only coordinates change.
    expect(next.map((p) => [p.id, p.col, p.row])).toEqual([
      ["a", 1, 4],
      ["b", 1, 2],
      ["c", 1, 3],
      ["d", 2, 1],
    ]);
  });

  it("works in TALL mode along the row-major stream", () => {
    // Tall: 2 columns, row-major. a@(1,1), b@(2,1); drag a to cell (2,1).
    const placements: Placement[] = [
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "b", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ];
    const next = displacePlace(placements, "a", { col: 2, row: 1 }, TALL);
    // b pushed forward past the row's end → next row. Stream order: a(1) b(2).
    expect(next.map((p) => [p.id, p.col, p.row])).toEqual([
      ["a", 2, 1],
      ["b", 1, 2],
    ]);
  });

  it("the stream helper renders the documented examples (sanity)", () => {
    const placements: Placement[] = [
      { id: "X", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "X2", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
      { id: "Y", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ];
    const next = displacePlace(placements, "Y", { col: 1, row: 1 }, WIDE);
    expect(stream(next, WIDE)).toBe("YXX");
    const placements2: Placement[] = [
      { id: "X", col: 1, row: 2, colSpan: 1, rowSpan: 1 },
      { id: "Z", col: 1, row: 3, colSpan: 1, rowSpan: 1 },
      { id: "Y", col: 2, row: 1, colSpan: 1, rowSpan: 1 },
    ];
    const next2 = displacePlace(placements2, "Y", { col: 1, row: 2 }, WIDE);
    expect(stream(next2, WIDE)).toBe("_YXZ");
  });
});

describe("placeAtCell", () => {
  it("pins every tile at its displaced anchor in the universal frame", () => {
    // Wide: a@(1,1), b@(1,2); drag a to (2,1) — a pins there, b KEEPS its
    // cell (the gap at (1,1) opens and stays).
    const tiles = [tile("a", 0), tile("b", 1)];
    const next = placeAtCell(tiles, "a", { col: 2, row: 1 }, WIDE);
    expect(next.find((t) => t.id === "a")).toMatchObject({ col: 2, row: 1 });
    expect(next.find((t) => t.id === "b")).toMatchObject({ col: 1, row: 2 });
    // And the pinned layout packs exactly as placed (b first — stream order).
    expect(pack(next, WIDE).map((p) => [p.id, p.col, p.row])).toEqual([
      ["b", 1, 2],
      ["a", 2, 1],
    ]);
  });

  it("keeps persisted spans raw (never clamped) through the commit", () => {
    // A 4-wide desktop tile dropped in TALL commits the tall cell but keeps
    // its raw 4-wide span.
    const tiles = [{ ...tile("big", 0, 4, 1) }, tile("b", 1)];
    const next = placeAtCell(tiles, "big", { col: 1, row: 3 }, TALL);
    expect(next.find((t) => t.id === "big")).toMatchObject({
      colSpan: 4,
      rowSpan: 1,
      col: 1,
      row: 5,
    });
  });

  it("renumbers orders densely in stream order", () => {
    const tiles = [tile("a", 0), tile("b", 5), tile("c", 9)];
    const next = placeAtCell(tiles, "c", { col: 1, row: 1 }, WIDE);
    expect(next.every((t, i) => t.order === i)).toBe(true);
  });

  it("maps tall commits to the universal frame", () => {
    // Tall (col 2, row 1) → universal (col 1, row 2).
    const tiles = [tile("a", 0)];
    const next = placeAtCell(tiles, "a", { col: 2, row: 1 }, TALL);
    expect(next.find((t) => t.id === "a")).toMatchObject({ col: 1, row: 2 });
  });

  it("an unknown id changes nothing (no-op)", () => {
    const tiles = [tile("a", 0)];
    expect(placeAtCell(tiles, "nope", { col: 1, row: 1 }, WIDE)).toEqual(tiles);
  });
});

describe("dragAppendLimit", () => {
  it("caps a wide drag at 3 columns past the right-most content edge (span-aware)", () => {
    // b spans cols 3-4 → the right-most occupied column is 4; +3 = 7.
    const placements: Placement[] = [
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { id: "b", col: 3, row: 1, colSpan: 2, rowSpan: 1 },
    ];
    expect(dragAppendLimit(placements, WIDE)).toBe(7);
  });

  it("caps a tall drag at 3 rows past the bottom-most content edge (span-aware)", () => {
    // b spans rows 3-4 → the bottom-most occupied row is 4; +3 = 7.
    const placements: Placement[] = [
      { id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 2 },
      { id: "b", col: 2, row: 3, colSpan: 1, rowSpan: 2 },
    ];
    expect(dragAppendLimit(placements, TALL)).toBe(7);
  });

  it("an empty grid still allows the first tiles within the first 3 columns", () => {
    expect(dragAppendLimit([], WIDE)).toBe(3);
    expect(dragAppendLimit([], TALL)).toBe(3);
  });

  it("honors a custom extra", () => {
    const placements: Placement[] = [{ id: "a", col: 1, row: 1, colSpan: 1, rowSpan: 1 }];
    expect(dragAppendLimit(placements, WIDE, 5)).toBe(6);
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

  it("CLEARs every pin (an explicit arrangement reset — gaps gone)", () => {
    const tiles: TileLayoutEntry[] = [
      { ...tile("a", 0), col: 1, row: 1 },
      { ...tile("b", 1), col: 2, row: 3 },
    ];
    const next = sortByRecentActivity(
      tiles,
      new Map([
        ["a", 100],
        ["b", 300],
      ]),
    );
    expect(next.every((t) => t.col === undefined && t.row === undefined)).toBe(true);
    // And the now-unpinned layout packs compactly.
    expect(pack(next, WIDE).map((p) => [p.id, p.col, p.row])).toEqual([
      ["b", 1, 1],
      ["a", 1, 2],
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
  it("accepts a valid v2 document (anchors kept)", () => {
    expect(
      sanitizeLayout({
        version: 2,
        tiles: [{ id: "a", colSpan: 2, rowSpan: 1, order: 0, col: 3, row: 2 }],
      }),
    ).toEqual({
      version: 2,
      tiles: [{ id: "a", colSpan: 2, rowSpan: 1, order: 0, col: 3, row: 2 }],
    });
  });

  it("MIGRATES a v1 document to v2 in memory (all tiles unpinned)", () => {
    expect(
      sanitizeLayout({ version: 1, tiles: [{ id: "a", colSpan: 2, rowSpan: 1, order: 0 }] }),
    ).toEqual({
      version: 2,
      tiles: [{ id: "a", colSpan: 2, rowSpan: 1, order: 0 }],
    });
  });

  it("rejects foreign versions and malformed documents", () => {
    expect(sanitizeLayout(null)).toEqual({ version: 2, tiles: [] });
    expect(sanitizeLayout("nope")).toEqual({ version: 2, tiles: [] });
    expect(sanitizeLayout({ version: 3, tiles: [] })).toEqual({ version: 2, tiles: [] });
    expect(sanitizeLayout({ version: 1, tiles: "x" })).toEqual({ version: 2, tiles: [] });
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

  it("drops garbage anchors (non-positive / fractional / half a pair)", () => {
    const data = sanitizeLayout({
      version: 2,
      tiles: [
        { id: "ok", colSpan: 1, rowSpan: 1, order: 0, col: 2, row: 3 },
        { id: "frac", colSpan: 1, rowSpan: 1, order: 1, col: 2.5, row: 3 },
        { id: "zero", colSpan: 1, rowSpan: 1, order: 2, col: 0, row: 1 },
        { id: "lone", colSpan: 1, rowSpan: 1, order: 3, col: 2 },
        { id: "neg", colSpan: 1, rowSpan: 1, order: 4, col: -1, row: -1 },
      ],
    });
    expect(data.tiles).toEqual([
      { id: "ok", colSpan: 1, rowSpan: 1, order: 0, col: 2, row: 3 },
      { id: "frac", colSpan: 1, rowSpan: 1, order: 1, col: 2, row: 3 },
      { id: "zero", colSpan: 1, rowSpan: 1, order: 2 },
      { id: "lone", colSpan: 1, rowSpan: 1, order: 3 },
      { id: "neg", colSpan: 1, rowSpan: 1, order: 4 },
    ]);
  });
});

describe("geometry-agnostic persistence", () => {
  it("the SAME persisted data renders in either geometry (unpinned flow re-derives)", () => {
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
    // An unpinned entry carries NO anchor — only id/spans/order.
    expect(Object.keys(tiles[0] ?? {}).sort()).toEqual(["colSpan", "id", "order", "rowSpan"]);
  });
});

describe("pinned pack (v2)", () => {
  it("pinned tiles land at their anchors; unpinned flow into the remaining free cells", () => {
    const tiles: TileLayoutEntry[] = [
      { ...tile("a", 0), col: 1, row: 3 },
      { ...tile("b", 1), col: 1, row: 1 },
      tile("c", 2), // unpinned → first free = (1,2)
      tile("d", 3), // unpinned → next free = (1,4)
    ];
    // pack returns ENTRY order (a, b, c, d); positions are what matters.
    const placements = pack(tiles, WIDE);
    expect(placements.map((p) => [p.id, p.col, p.row])).toEqual([
      ["a", 1, 3],
      ["b", 1, 1],
      ["c", 1, 2],
      ["d", 1, 4],
    ]);
  });

  it("keeps the GAP between two pins (flow does not compact it away)", () => {
    const tiles: TileLayoutEntry[] = [
      { ...tile("a", 0), col: 1, row: 1 },
      { ...tile("z", 1), col: 1, row: 4 },
    ];
    expect(pack(tiles, WIDE).map((p) => [p.id, p.row])).toEqual([
      ["a", 1],
      ["z", 4],
    ]);
  });

  it("a pin whose span no longer fits its anchor reads as UNPINNED (flows)", () => {
    // A 2-tall tile pinned at row 4 cannot fit the 4-row cross-axis at that
    // anchor → it flows to the first fitting slot instead: (1,2).
    const tiles: TileLayoutEntry[] = [
      { ...tile("big", 0, 1, 2), col: 1, row: 4 },
      { ...tile("a", 1), col: 1, row: 1 },
    ];
    const placements = pack(tiles, WIDE);
    expect(placements.find((p) => p.id === "big")).toMatchObject({ col: 1, row: 2 });
  });

  it("overlapping pins resolve first-wins by entry order (the loser flows)", () => {
    const tiles: TileLayoutEntry[] = [
      { ...tile("a", 0), col: 1, row: 2 },
      { ...tile("b", 1), col: 1, row: 2 },
    ];
    const placements = pack(tiles, WIDE);
    expect(placements.find((p) => p.id === "a")).toMatchObject({ col: 1, row: 2 });
    expect(placements.find((p) => p.id === "b")).toMatchObject({ col: 1, row: 1 });
  });

  it("a wide pin at col > 1 reads as UNPINNED in tall (documented lossy case)", () => {
    const tiles: TileLayoutEntry[] = [{ ...tile("a", 0), col: 3, row: 1 }];
    expect(pack(tiles, TALL).find((p) => p.id === "a")).toMatchObject({ col: 1, row: 1 });
  });

  it("tall pins map through the universal frame in both directions", () => {
    // Universal column 1 folds onto tall's 2 columns in reading order:
    // u1→(1,1) u2→(2,1) u3→(1,2) u4→(2,2).
    expect(toRenderCell({ col: 1, row: 1 }, TALL)).toEqual({ col: 1, row: 1 });
    expect(toRenderCell({ col: 1, row: 2 }, TALL)).toEqual({ col: 2, row: 1 });
    expect(toRenderCell({ col: 1, row: 3 }, TALL)).toEqual({ col: 1, row: 2 });
    expect(toRenderCell({ col: 1, row: 4 }, TALL)).toEqual({ col: 2, row: 2 });
    expect(toUniversalCell({ col: 2, row: 2 }, TALL)).toEqual({ col: 1, row: 4 });
    // Wide is the identity.
    expect(toRenderCell({ col: 2, row: 2 }, WIDE)).toEqual({ col: 2, row: 2 });
    expect(toUniversalCell({ col: 2, row: 2 }, WIDE)).toEqual({ col: 2, row: 2 });
    expect(UNIVERSAL_ROWS).toBe(4);
  });

  it("a layout dragged in TALL renders its pins when back in WIDE", () => {
    // Committed in tall: a at tall (1,1) → universal (1,1); b at tall (2,1) →
    // universal (1,2). Back in wide they render exactly there (col 1).
    const tiles: TileLayoutEntry[] = [
      { ...tile("a", 0), col: 1, row: 1 },
      { ...tile("b", 1), col: 1, row: 2 },
    ];
    expect(pack(tiles, WIDE).map((p) => [p.id, p.col, p.row])).toEqual([
      ["a", 1, 1],
      ["b", 1, 2],
    ]);
  });

  it("deleting a workspace leaves its cells EMPTY (mergeLayout keeps other pins)", () => {
    const persisted = {
      version: 2 as const,
      tiles: [
        { ...tile("a", 0), col: 1, row: 1 },
        { ...tile("gone", 1), col: 1, row: 2 },
        { ...tile("b", 2), col: 1, row: 3 },
      ] as TileLayoutEntry[],
    };
    const merged = mergeLayout(persisted, ["a", "b"]);
    expect(merged.map((t) => [t.id, t.col, t.row])).toEqual([
      ["a", 1, 1],
      ["b", 1, 3],
    ]);
    // The gap at (1,2) stays: a new workspace flows/pins INTO it.
    expect(firstEmptySlot(merged, { colSpan: 1, rowSpan: 1 }, WIDE)).toEqual({ col: 1, row: 2 });
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
