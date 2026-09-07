/**
 * Pure tile-layout logic for the Win8-Start-style workspace home grid — zero
 * DOM, zero Svelte, zero effects.
 *
 * The PERSISTED data (v2): `{ version, tiles: [{ id, colSpan, rowSpan, order,
 * col?, row? }] }` — each tile's spans, arrival order, and OPTIONAL pinned
 * anchor. Anchors live in a UNIVERSAL 4-row frame (wide's frame; tall folds
 * its 2 columns onto frame column 1), so the same document renders in either
 * geometry with no orientation conversion step: an anchor that doesn't map
 * into the current geometry (or whose clamped span can't fit there) reads as
 * UNPINNED, and unpinned tiles flow into the first free cells — holes between
 * pins included. Empty cells are real: nothing ever slides backward, so gaps
 * only close when a drop's displacement pushes a run of filled cells through
 * them (see {@link displacePlace}).
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

/** One persisted tile: which workspace it pins, how big it wants to be, its manual order, and its anchor. */
export interface TileLayoutEntry {
  /** The workspace id (the slug). */
  readonly id: string;
  readonly colSpan: number;
  readonly rowSpan: number;
  /** Lower sorts earlier. Arrival order for unpinned flow + first-wins tie-breaks. */
  readonly order: number;
  /**
   * The pinned anchor cell (1-based) in the UNIVERSAL 4-row frame, or absent =
   * unpinned (the tile flows into the first free cells at render time). Tall
   * mode normalizes its 2-column grid into this frame: render { c, r } ↔
   * universal { col: 1, row: 2(r−1)+c }. A pin outside the current geometry's
   * fixed cross-axis reads as UNPINNED (render-time clamp — like spans).
   */
  readonly col?: number;
  readonly row?: number;
}

/** The persisted document (localStorage via the injected `LocalStore` adapter). */
export interface TileLayoutData {
  readonly version: 1 | 2;
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

/**
 * The universal frame's fixed row count (the wide grid's). Tall render cells
 * map onto column 1 of this frame; wide is the identity.
 */
export const UNIVERSAL_ROWS = 4;

/** A tile's anchor cell (1-based). */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * Universal-frame anchor → render-geometry cell. Wide: identity. Tall: column
 * 1 of the universal frame folds onto the 2 render columns (universal row u →
 * render { col: (u−1)%2 + 1, row: ⌈u/2⌉ }); any universal col > 1 cannot be
 * represented in tall → `null` (the tile reads as UNPINNED in tall).
 * Pure.
 */
export function toRenderCell(anchor: Cell, geometry: GridGeometry): Cell | null {
  if (geometry.mode === "wide") return anchor;
  if (anchor.col !== 1) return null;
  return { col: ((anchor.row - 1) % 2) + 1, row: Math.floor((anchor.row - 1) / 2) + 1 };
}

/** Render-geometry cell → universal-frame anchor (the commit direction). Pure. */
export function toUniversalCell(cell: Cell, geometry: GridGeometry): Cell {
  if (geometry.mode === "wide") return cell;
  return { col: 1, row: 2 * (cell.row - 1) + cell.col };
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
 * THE entries → coordinates transform, v2. Two passes, one scan each:
 *
 * 1. **Pinned pass** (in entry order — first-pinned-wins on overlap, strictly
 *    one-ply: a displaced pin never bumps another pin): a pinned tile lands at
 *    its anchor (universal frame → render cell) when the anchor maps into this
 *    geometry, its clamped footprint fits the fixed cross-axis there, and no
 *    already-placed tile overlaps. Otherwise the tile reads as UNPINNED.
 * 2. **Flow pass**: unpinned tiles (never pinned, out-of-range, clashing) take
 *    the first fitting FREE slot in fill order — holes between pins count.
 *
 * Requested spans clamp to the geometry (render-time only; the persisted spans
 * stay raw). Pure: entries + geometry in, a NEW placements array out (entry
 * order — the render order).
 */
export function pack(tiles: readonly TileLayoutEntry[], geometry: GridGeometry): Placement[] {
  const occupied = new Set<string>();
  const placements: (Placement | undefined)[] = [];
  const flowing: { index: number; tile: TileLayoutEntry }[] = [];
  const ordered = sortTiles(tiles);
  for (let index = 0; index < ordered.length; index++) {
    const tile = ordered[index];
    if (!tile) continue;
    const { colSpan, rowSpan } = clampSpan(tile, geometry);
    const anchor = pinnedAnchor(tile, geometry);
    if (
      anchor !== null &&
      fitsCrossAxis(anchor, colSpan, rowSpan, geometry) &&
      cellsFree(occupied, anchor.col, anchor.row, colSpan, rowSpan)
    ) {
      occupy(occupied, anchor.col, anchor.row, colSpan, rowSpan);
      placements[index] = { id: tile.id, col: anchor.col, row: anchor.row, colSpan, rowSpan };
    } else {
      flowing.push({ index, tile });
    }
  }
  for (const { index, tile } of flowing) {
    const { colSpan, rowSpan } = clampSpan(tile, geometry);
    const slot = firstFit(occupied, { colSpan, rowSpan }, geometry);
    occupy(occupied, slot.col, slot.row, colSpan, rowSpan);
    placements[index] = { id: tile.id, col: slot.col, row: slot.row, colSpan, rowSpan };
  }
  return placements.filter((placement) => placement !== undefined);
}

/**
 * A pinned tile's render-geometry anchor, or `null` when the tile is unpinned
 * (no anchor) or its anchor cannot be represented in this geometry (a wide
 * column > 1 read in tall). Pure.
 */
function pinnedAnchor(tile: TileLayoutEntry, geometry: GridGeometry): Cell | null {
  if (tile.col === undefined || tile.row === undefined) return null;
  return toRenderCell({ col: tile.col, row: tile.row }, geometry);
}

/** The footprint fits the geometry's FIXED cross-axis at this anchor. */
function fitsCrossAxis(
  anchor: Cell,
  colSpan: number,
  rowSpan: number,
  geometry: GridGeometry,
): boolean {
  if (geometry.mode === "wide") return anchor.row + rowSpan - 1 <= geometry.flowRows;
  return anchor.col + colSpan - 1 <= geometry.flowCols;
}

/**
 * The first fitting slot at or after a minimum stream key (the displacement
 * re-anchor scan — pushed tiles only move FORWARD). Pure.
 */
function firstFitFrom(
  occupied: ReadonlySet<string>,
  span: Span,
  geometry: GridGeometry,
  minKey: number,
): Cell {
  const { colSpan, rowSpan } = clampSpan(span, geometry);
  if (geometry.mode === "wide") {
    const maxCol = maxOccupied(occupied, "col") + 1;
    for (let col = 1; col <= maxCol + 1; col++) {
      for (let row = 1; row <= geometry.flowRows - rowSpan + 1; row++) {
        if (fillOrderKey(col, row, geometry) < minKey) continue;
        if (cellsFree(occupied, col, row, colSpan, rowSpan)) return { col, row };
      }
    }
    return { col: maxCol + 2, row: 1 };
  }
  const maxRow = maxOccupied(occupied, "row") + 1;
  for (let row = 1; row <= maxRow + 1; row++) {
    for (let col = 1; col <= geometry.flowCols - colSpan + 1; col++) {
      if (fillOrderKey(col, row, geometry) < minKey) continue;
      if (cellsFree(occupied, col, row, colSpan, rowSpan)) return { col, row };
    }
  }
  return { col: 1, row: maxRow + 2 };
}

/**
 * THE displacement op — drop `draggedId` at `cell` over the CURRENT RENDER
 * placements (the squares exactly as the user sees them). Semantics (user-
 * specified): the dragged tile leaves its slot (the gap OPENS — nothing slides
 * backward, ever), anchors exactly at `cell`, and the contiguous run of filled
 * cells pushes FORWARD in fill order until the first empty cell absorbs it:
 *
 *   `X _ X`  + Y at slot 1 → `Y X X`
 *   `_ X Z _` + Y at slot 2 → `_ Y X Z`
 *
 * Tiles keep their positions unless their footprint overlaps an already-placed
 * one; the displaced re-anchor at the next fitting slot forward (spans ride
 * along; a span that can't fit the fixed cross-axis anywhere forward wraps to
 * the first fitting slot — it must land somewhere). Pure: placements + drop
 * in, a NEW placements array out (stream order).
 */
export function displacePlace(
  placements: readonly Placement[],
  draggedId: string,
  cell: Cell,
  geometry: GridGeometry,
): Placement[] {
  const dragged = placements.find((placement) => placement.id === draggedId);
  if (!dragged) return [...placements];
  const occupied = new Set<string>();
  occupy(occupied, cell.col, cell.row, dragged.colSpan, dragged.rowSpan);
  const placed: Placement[] = [{ ...dragged, col: cell.col, row: cell.row }];
  const others = placements
    .filter((placement) => placement.id !== draggedId)
    .map((placement) => ({
      placement,
      key: fillOrderKey(placement.col, placement.row, geometry),
    }))
    .sort((a, b) => a.key - b.key);
  for (const { placement, key } of others) {
    const { colSpan, rowSpan } = placement;
    if (cellsFree(occupied, placement.col, placement.row, colSpan, rowSpan)) {
      occupy(occupied, placement.col, placement.row, colSpan, rowSpan);
      placed.push(placement);
      continue;
    }
    let slot = firstFitFrom(occupied, placement, geometry, key);
    if (!fitsCrossAxis(slot, colSpan, rowSpan, geometry)) {
      slot = firstFit(occupied, placement, geometry);
    }
    occupy(occupied, slot.col, slot.row, colSpan, rowSpan);
    placed.push({ ...placement, col: slot.col, row: slot.row });
  }
  return placed.sort(
    (a, b) => fillOrderKey(a.col, a.row, geometry) - fillOrderKey(b.col, b.row, geometry),
  );
}

/**
 * The commit path: pack the persisted entries, displace at `cell`, and pin
 * EVERY tile back to the entries at its resulting anchor (universal frame —
 * the persisted spans stay raw, only anchors + order change; order renumbers
 * in stream order). This is the drag-drop write. Pure: entries in, NEW
 * entries out.
 */
export function placeAtCell(
  tiles: readonly TileLayoutEntry[],
  id: string,
  cell: Cell,
  geometry: GridGeometry,
): TileLayoutEntry[] {
  // An unknown dragged id changes nothing (order-sorted copy — the op's
  // canonical no-op shape, like `moveTile` before it).
  if (!tiles.some((tile) => tile.id === id)) return sortTiles(tiles);
  const displaced = displacePlace(pack(tiles, geometry), id, cell, geometry);
  const result: TileLayoutEntry[] = [];
  for (const placement of displaced) {
    const entry = tiles.find((tile) => tile.id === placement.id);
    if (!entry) continue;
    const anchor = toUniversalCell(placement, geometry);
    result.push({ ...entry, col: anchor.col, row: anchor.row });
  }
  return result.map((entry, index) => (entry.order === index ? entry : { ...entry, order: index }));
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
 * Pin a tile at the first EMPTY slot in fill order — the header-create
 * placement (holes between pins count). Idempotent: an id already in the
 * layout is RE-PINNED there (spans preserved), not duplicated — this closes
 * the race where the list-refresh sync appended the id first. Unknown ids
 * append as a new 1×1 pinned entry. Pure: entries in, a NEW entries array out
 * (order preserved — anchors, not order, place tiles now).
 */
export function pinAtFirstEmpty(
  tiles: readonly TileLayoutEntry[],
  id: string,
  geometry: GridGeometry,
): TileLayoutEntry[] {
  const without = sortTiles(tiles).filter((tile) => tile.id !== id);
  const slot = firstEmptySlot(without, { colSpan: 1, rowSpan: 1 }, geometry);
  const anchor = toUniversalCell(slot, geometry);
  const existing = tiles.find((tile) => tile.id === id);
  const entry: TileLayoutEntry = existing
    ? { ...existing, col: anchor.col, row: anchor.row }
    : {
        id,
        colSpan: 1,
        rowSpan: 1,
        order: without.reduce((max, tile) => Math.max(max, tile.order + 1), 0),
        col: anchor.col,
        row: anchor.row,
      };
  return [...without, entry];
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
 * Re-apply the recent-activity order (the header overflow "Sort" action) AND
 * clear every pin — an explicit ARRANGEMENT RESET: tiles sort by their
 * workspace's `lastActivityAt` descending (unknown ids last, ties stable),
 * orders renumber, and the now-unpinned tiles first-fit with no gaps. Pure.
 */
export function sortByRecentActivity(
  tiles: readonly TileLayoutEntry[],
  lastActivityById: ReadonlyMap<string, number>,
): TileLayoutEntry[] {
  const sorted = sortTiles(tiles).sort(
    (a, b) => (lastActivityById.get(b.id) ?? 0) - (lastActivityById.get(a.id) ?? 0),
  );
  return renumber(
    sorted.map((tile) => {
      const { col: _col, row: _row, ...unpinned } = tile;
      return unpinned;
    }),
  );
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
 * is untyped at the boundary). v1 documents (order + spans only) MIGRATE to
 * v2 in memory: their tiles become unpinned, which packs identically to v1's
 * first-fit — the layout only starts carrying anchors after the user's first
 * drop. v2 entries keep their anchors; malformed entries coerce (missing
 * spans → 1, garbage anchors → unpinned, garbage entries → dropped). Anything
 * else yields the empty layout. Pure: unknown in, v2 data out.
 */
export function sanitizeLayout(raw: unknown): TileLayoutData {
  if (typeof raw !== "object" || raw === null) return EMPTY_LAYOUT;
  const version = (raw as { version?: unknown }).version;
  if (version !== 1 && version !== 2) return EMPTY_LAYOUT;
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
    const col = coerceAnchor((rawTile as { col?: unknown }).col);
    const row = coerceAnchor((rawTile as { row?: unknown }).row);
    tiles.push({
      id,
      colSpan: coerceSpan((rawTile as { colSpan?: unknown }).colSpan),
      rowSpan: coerceSpan((rawTile as { rowSpan?: unknown }).rowSpan),
      order: coerceOrder((rawTile as { order?: unknown }).order, index),
      // An anchor is only meaningful as a PAIR — a lone coordinate drops both.
      ...(version === 2 && col !== undefined && row !== undefined ? { col, row } : {}),
    });
  }
  return { version: 2, tiles };
}

const EMPTY_LAYOUT: TileLayoutData = { version: 2, tiles: [] };

function coerceSpan(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function coerceOrder(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

/** A valid anchor coordinate (1-based positive integer) or undefined. */
function coerceAnchor(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}
