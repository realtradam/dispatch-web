/**
 * Pure tile-layout logic for the Win8-Start-style workspace home grid — zero
 * DOM, zero Svelte, zero effects.
 *
 * The PERSISTED data is orientation-independent: `{ version, tiles: [{ id,
 * colSpan, rowSpan, order }] }` — the manual tile order + requested spans
 * ONLY, never positions. Positions are re-derived by {@link pack} from the
 * CURRENT geometry, so the same data renders in either geometry (wide desktop
 * / tall mobile) with no orientation conversion step: a tile whose persisted
 * span exceeds the geometry's cap simply renders clamped (the persisted span
 * is untouched).
 *
 * Terminology (distinct from the layout feature's nested split-tree "tile"):
 * a HOME TILE is one workspace's cell in the flat start-screen grid.
 */

/** The grid geometry mode: landscape/desktop ("wide") or portrait/mobile ("tall"). */
export type TileGeometryMode = "wide" | "tall";

/** The px size of one tile unit (one grid cell) + the grid gap. */
export interface TileUnitSize {
  /**
   * The unit's px width. `0` means "fluid" (the tall grid sizes its fixed
   * columns in `1fr` so two tiles fill a phone's width).
   */
  readonly width: number;
  readonly height: number;
  readonly gap: number;
}

/**
 * The full grid geometry a viewport resolves to. `flowRows`/`flowCols` name
 * the FIXED track counts across the fill direction's cross axis:
 * wide mode fixes ROWS (tiles flow column-wise, columns grow unbounded);
 * tall mode fixes COLS (tiles flow row-wise, rows grow unbounded). `0` =
 * unbounded. The picker (resize) dimensions equal the span caps.
 */
export interface GridGeometry {
  readonly mode: TileGeometryMode;
  /** Fixed row tracks (wide: 4; tall: 0 = rows grow unbounded). */
  readonly flowRows: number;
  /** Fixed column tracks (tall: 2; wide: 0 = columns grow unbounded). */
  readonly flowCols: number;
  /** Maximum horizontal span a tile may occupy in this geometry. */
  readonly maxColSpan: number;
  /** Maximum vertical span a tile may occupy in this geometry. */
  readonly maxRowSpan: number;
  readonly unit: TileUnitSize;
  /**
   * The breathing room around the whole tile field — the grid never renders
   * flush against the canvas edge. In wide mode the scroller pads all four
   * sides by this amount (the pan arrow/scroll indicator offset inward by it
   * too); in tall mode it insets the two fluid columns horizontally.
   */
  readonly margin: number;
}

/** One persisted tile: which workspace it pins, how big it wants to be, and its manual position in the order. */
export interface TileLayoutEntry {
  /** The workspace id (the slug). */
  readonly id: string;
  readonly colSpan: number;
  readonly rowSpan: number;
  /** Lower sorts earlier. Positions are NEVER persisted — only this order. */
  readonly order: number;
}

/** The persisted document (localStorage via the injected `LocalStore` adapter). */
export interface TileLayoutData {
  readonly version: 1;
  readonly tiles: readonly TileLayoutEntry[];
}

/** A tile's resolved footprint on the grid (1-based grid coordinates). */
export interface Placement {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** A requested span (pre-clamping). */
export interface Span {
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** The viewport assumed before the canvas has been measured (a landscape desktop). */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * The wide unit's clamp band (px). Tiles FILL the canvas' height across the 4
 * fixed rows (the Start-screen feel), but never shrink below a legible small
 * tile nor grow past a comfortable large one.
 */
const WIDE_UNIT_MIN = 112;
const WIDE_UNIT_MAX = 184;

/** The wide canvas' outer margin band (px) — proportional to the unit size. */
const WIDE_MARGIN_MIN = 24;
const WIDE_MARGIN_MAX = 64;

/** The tall unit: the two fluid columns size in `1fr` (width `0` = fluid). */
const TALL_UNIT: TileUnitSize = { width: 0, height: 148, gap: 12 };
const TALL_MARGIN = 16;

/** Round to whole pixels (fractional track sizes blur tile edges). */
function px(value: number): number {
  return Math.round(value);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolve the grid geometry from the tile canvas' size. Landscape/desktop →
 * WIDE (4 fixed rows, column-wise flow, 4×2 span cap); portrait/mobile → TALL
 * (2 fixed columns, row-wise flow, 2×2 span cap). Degenerate sizes (not yet
 * measured) resolve to wide.
 *
 * The wide unit is DERIVED from the canvas height so the 4 rows exactly fill
 * it (unit + margin + gap all proportional, clamped to their bands); the tall
 * unit is fixed (its columns are fluid instead). Pure: numbers in, geometry
 * out.
 */
export function geometryFor(width: number, height: number): GridGeometry {
  const tall = width > 0 && height > 0 && height > width;
  if (tall) {
    return {
      mode: "tall",
      flowRows: 0,
      flowCols: 2,
      maxColSpan: 2,
      maxRowSpan: 2,
      unit: TALL_UNIT,
      margin: TALL_MARGIN,
    };
  }
  // Solve 4·unit + 3·gap + 2·margin = height with gap = unit/9 and margin =
  // unit/3: 4u + u/3 + 2u/3 = 5u → u = height/5. Unmeasured (height ≤ 0) →
  // the band's middle, not a tiny tile.
  const raw = height > 0 ? height / 5 : (WIDE_UNIT_MIN + WIDE_UNIT_MAX) / 2;
  const unit = px(clampNumber(raw, WIDE_UNIT_MIN, WIDE_UNIT_MAX));
  const gap = Math.max(10, px(unit / 9));
  const margin = px(clampNumber(unit / 3, WIDE_MARGIN_MIN, WIDE_MARGIN_MAX));
  return {
    mode: "wide",
    flowRows: 4,
    flowCols: 0,
    maxColSpan: 4,
    maxRowSpan: 2,
    unit: { width: unit, height: unit, gap },
    margin,
  };
}

/** Sort entries by their persisted order (stable — ties keep their relative order). */
export function sortTiles<T extends TileLayoutEntry>(tiles: readonly T[]): T[] {
  return [...tiles].sort((a, b) => a.order - b.order);
}

/** Clamp a requested span to a geometry's caps, coercing garbage (non-positive/NaN) to 1. */
export function clampSpan<T extends Span>(span: T, geometry: GridGeometry): Span {
  return {
    colSpan: clampUnit(span.colSpan, geometry.maxColSpan),
    rowSpan: clampUnit(span.rowSpan, geometry.maxRowSpan),
  };
}

function clampUnit(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  const int = Math.floor(value);
  if (int < 1) return 1;
  return Math.min(int, max);
}

/**
 * A position's rank in the geometry's FILL ORDER — the order slots are visited
 * when packing: wide fills column-wise (top-to-bottom, then the next column);
 * tall fills row-wise (left-to-right, then the next row). Pure; only used for
 * comparisons within one geometry.
 */
export function fillOrderKey(col: number, row: number, geometry: GridGeometry): number {
  if (geometry.mode === "wide") return (col - 1) * geometry.flowRows + (row - 1);
  return (row - 1) * geometry.flowCols + (col - 1);
}

function cellsFree(
  occupied: ReadonlySet<string>,
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
): boolean {
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      if (occupied.has(`${r}:${c}`)) return false;
    }
  }
  return true;
}

function occupy(
  occupied: Set<string>,
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
): void {
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      occupied.add(`${r}:${c}`);
    }
  }
}

function maxOccupied(occupied: ReadonlySet<string>, axis: "col" | "row"): number {
  let max = 0;
  for (const cell of occupied) {
    const value = Number.parseInt(
      axis === "row" ? (cell.split(":")[0] ?? "") : (cell.split(":")[1] ?? ""),
      10,
    );
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/**
 * The first slot (in fill order) where a span-sized footprint fits without
 * overlapping or exceeding the geometry's fixed cross-axis. Beyond the
 * occupied region every cell is free, so the scan is bounded by the occupied
 * extent — the result always exists (the flow is unbounded along its main
 * axis). Pure: occupancy + span + geometry in, slot out.
 */
function firstFit(
  occupied: ReadonlySet<string>,
  span: Span,
  geometry: GridGeometry,
): { col: number; row: number } {
  const { colSpan, rowSpan } = clampSpan(span, geometry);
  if (geometry.mode === "wide") {
    const maxCol = maxOccupied(occupied, "col");
    for (let col = 1; col <= maxCol; col++) {
      for (let row = 1; row <= geometry.flowRows - rowSpan + 1; row++) {
        if (cellsFree(occupied, col, row, colSpan, rowSpan)) return { col, row };
      }
    }
    return { col: maxCol + 1, row: 1 };
  }
  const maxRow = maxOccupied(occupied, "row");
  for (let row = 1; row <= maxRow; row++) {
    for (let col = 1; col <= geometry.flowCols - colSpan + 1; col++) {
      if (cellsFree(occupied, col, row, colSpan, rowSpan)) return { col, row };
    }
  }
  return { col: 1, row: maxRow + 1 };
}

/**
 * THE order → coordinates transform: place the tiles (in their persisted
 * order) into the first fitting slot in the geometry's fill order — greedy
 * first-fit, so every fitting slot is used before the flow advances (no
 * intentional holes). Requested spans clamp to the geometry (a 3×1 desktop
 * tile in tall mode packs as 2×1 — the persisted span is untouched). Pure:
 * entries + geometry in, a NEW placements array out (in pack order, which
 * respects the persisted order).
 */
export function pack(tiles: readonly TileLayoutEntry[], geometry: GridGeometry): Placement[] {
  const occupied = new Set<string>();
  const placements: Placement[] = [];
  for (const tile of sortTiles(tiles)) {
    const { colSpan, rowSpan } = clampSpan(tile, geometry);
    const slot = firstFit(occupied, { colSpan, rowSpan }, geometry);
    occupy(occupied, slot.col, slot.row, colSpan, rowSpan);
    placements.push({ id: tile.id, col: slot.col, row: slot.row, colSpan, rowSpan });
  }
  return placements;
}

/**
 * The first footprint-fitting EMPTY slot in fill order — where a NEW tile of
 * the given span would go (the header's create flow). Pure: entries + span +
 * geometry in, a slot placement out (always exists; may be a new column/row
 * beyond the current extent).
 */
export function firstEmptySlot(
  tiles: readonly TileLayoutEntry[],
  span: Span,
  geometry: GridGeometry,
): { col: number; row: number } {
  return firstFit(packOccupancy(tiles, geometry), span, geometry);
}

/** Build the occupancy set of the tiles' packed positions. */
function packOccupancy(tiles: readonly TileLayoutEntry[], geometry: GridGeometry): Set<string> {
  const occupied = new Set<string>();
  for (const placement of pack(tiles, geometry)) {
    occupy(occupied, placement.col, placement.row, placement.colSpan, placement.rowSpan);
  }
  return occupied;
}

/** Re-assign orders 0..n-1 by array position (the canonical order encoding after structural edits). */
function renumber(tiles: readonly TileLayoutEntry[]): TileLayoutEntry[] {
  return tiles.map((tile, index) => (tile.order === index ? tile : { ...tile, order: index }));
}

/**
 * Insert (or MOVE an already-present tile to) the first empty slot in fill
 * order — the header-create placement. The new tile is 1×1, and inserting it
 * before the first placement that starts AFTER the empty slot makes greedy
 * packing drop it exactly into that slot. Idempotent: an id already in the
 * layout is moved (spans preserved), not duplicated — this closes the race
 * where the list-refresh sync appended the id first. Pure: entries in, a NEW
 * entries array out (renumbered).
 */
export function insertAtFirstEmptySlot(
  tiles: readonly TileLayoutEntry[],
  id: string,
  geometry: GridGeometry,
): TileLayoutEntry[] {
  const without = sortTiles(tiles).filter((tile) => tile.id !== id);
  const slot = firstEmptySlot(without, { colSpan: 1, rowSpan: 1 }, geometry);
  const slotKey = fillOrderKey(slot.col, slot.row, geometry);
  const placements = pack(without, geometry);
  let index = placements.findIndex((p) => fillOrderKey(p.col, p.row, geometry) > slotKey);
  if (index === -1) index = without.length;
  const existing = tiles.find((tile) => tile.id === id);
  const entry: TileLayoutEntry = existing ?? { id, colSpan: 1, rowSpan: 1, order: 0 };
  return renumber([...without.slice(0, index), entry, ...without.slice(index)]);
}

/**
 * Resize one tile: set its persisted spans (sanitized to positive integers —
 * NOT clamped to the current geometry; clamping is a render-time concern so a
 * wide-sized tile survives an orientation switch). Unknown ids are ignored.
 * Pure: entries in, a NEW entries array out.
 */
export function resizeTile(
  tiles: readonly TileLayoutEntry[],
  id: string,
  colSpan: number,
  rowSpan: number,
): TileLayoutEntry[] {
  const sanitized: Span = {
    colSpan: clampUnit(colSpan, Number.MAX_SAFE_INTEGER),
    rowSpan: clampUnit(rowSpan, Number.MAX_SAFE_INTEGER),
  };
  return sortTiles(tiles).map((tile) =>
    tile.id === id ? { ...tile, colSpan: sanitized.colSpan, rowSpan: sanitized.rowSpan } : tile,
  );
}

/**
 * Move one tile to a position in the manual ORDER (the drag-reorder op). The
 * target index is in the CURRENT order-sorted array; the tile is removed and
 * re-inserted at the index, so dragging forward lands after the hovered tile
 * and dragging backward lands before it (the dragged tile takes the hovered
 * slot). Positions re-derive from the new order — never stored. Pure.
 */
export function moveTile(
  tiles: readonly TileLayoutEntry[],
  id: string,
  toIndex: number,
): TileLayoutEntry[] {
  const ordered = sortTiles(tiles);
  const from = ordered.findIndex((tile) => tile.id === id);
  if (from === -1 || toIndex === from) return ordered;
  const without = ordered.filter((tile) => tile.id !== id);
  const index = Math.max(0, Math.min(Math.floor(toIndex), without.length));
  const moved = ordered[from];
  if (!moved) return ordered;
  return renumber([...without.slice(0, index), moved, ...without.slice(index)]);
}

/**
 * Re-apply the recent-activity order (the header overflow "Sort" action):
 * tiles sort by their workspace's `lastActivityAt` descending (unknown ids
 * last, ties stable), then orders renumber. Pure.
 */
export function sortByRecentActivity(
  tiles: readonly TileLayoutEntry[],
  lastActivityById: ReadonlyMap<string, number>,
): TileLayoutEntry[] {
  const sorted = sortTiles(tiles).sort(
    (a, b) => (lastActivityById.get(b.id) ?? 0) - (lastActivityById.get(a.id) ?? 0),
  );
  return renumber(sorted);
}

/**
 * Merge the persisted layout with the live workspace list: workspaces unknown
 * to the layout (e.g. auto-created via deep-link) APPEND at the end (default
 * 1×1, order after the current max); entries for deleted workspaces DROP;
 * duplicate ids dedup (first wins); the result sorts by order. When a
 * geometry is given, the returned VIEW clamps spans to it (the persisted
 * document keeps the raw spans — clamping is transient per geometry). Pure:
 * both inputs in, a NEW entries array out.
 */
export function mergeLayout(
  persisted: TileLayoutData | null | undefined,
  workspaceIds: readonly string[],
  geometry?: GridGeometry,
): TileLayoutEntry[] {
  const known = new Set(workspaceIds);
  const kept: TileLayoutEntry[] = [];
  const seen = new Set<string>();
  let maxOrder = 0;
  for (const tile of sortTiles(persisted?.tiles ?? [])) {
    if (!known.has(tile.id) || seen.has(tile.id)) continue;
    seen.add(tile.id);
    kept.push(tile);
    if (tile.order > maxOrder) maxOrder = tile.order;
  }
  const appended: TileLayoutEntry[] = [];
  for (const id of workspaceIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    maxOrder += 1;
    appended.push({ id, colSpan: 1, rowSpan: 1, order: maxOrder });
  }
  const merged = [...kept, ...appended];
  if (!geometry) return merged;
  return merged.map((tile) => ({ ...tile, ...clampSpan(tile, geometry) }));
}

/**
 * Coerce an unknown parsed-JSON value into layout data (the `LocalStore` load
 * is untyped at the boundary). Anything but `{ version: 1, tiles: [...] }`
 * yields the empty layout; malformed entries coerce (missing spans → 1,
 * garbage → dropped). Pure: unknown in, data out.
 */
export function sanitizeLayout(raw: unknown): TileLayoutData {
  if (typeof raw !== "object" || raw === null) return EMPTY_LAYOUT;
  const version = (raw as { version?: unknown }).version;
  if (version !== 1) return EMPTY_LAYOUT;
  const rawTiles = (raw as { tiles?: unknown }).tiles;
  if (!Array.isArray(rawTiles)) return EMPTY_LAYOUT;
  const tiles: TileLayoutEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawTiles.length; index++) {
    const rawTile = rawTiles[index];
    if (typeof rawTile !== "object" || rawTile === null) continue;
    const id = (rawTile as { id?: unknown }).id;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    tiles.push({
      id,
      colSpan: coerceSpan((rawTile as { colSpan?: unknown }).colSpan),
      rowSpan: coerceSpan((rawTile as { rowSpan?: unknown }).rowSpan),
      order: coerceOrder((rawTile as { order?: unknown }).order, index),
    });
  }
  return { version: 1, tiles };
}

const EMPTY_LAYOUT: TileLayoutData = { version: 1, tiles: [] };

function coerceSpan(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function coerceOrder(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.floor(value);
}
