import type { LocalStore } from "../../adapters/local-storage";
import {
  type Cell,
  type GridGeometry,
  mergeLayout,
  pinAtFirstEmpty,
  placeAtCell,
  resizeTile,
  sanitizeLayout,
  sortByRecentActivity,
  type TileLayoutData,
  type TileLayoutEntry,
} from "./logic/tile-layout";

/**
 * The localStorage key for the home tile layout (spans + optional pinned
 * anchors in the universal 4-row frame — v2 documents; v1 loads migrate).
 */
export const TILE_LAYOUT_STORAGE_KEY = "dispatch.workspaces.tiles";

/**
 * Tile-layout store — a thin reactive wrapper over the persisted tile layout
 * document, persisted through the INJECTED `LocalStore` adapter (the repo's
 * local-storage effect). All mutations go through the pure `logic/tile-layout`
 * ops and write through to persistence. No ambient state: one instance per
 * home page, created by the page entry (or injected in tests).
 */
export interface TileLayoutStore {
  /** The persisted entries, order-sorted (raw spans + universal-frame anchors). */
  readonly entries: readonly TileLayoutEntry[];
  /**
   * Merge the live workspace ids into the layout: workspaces unknown to the
   * layout append (unpinned — they flow to the first free cells), entries for
   * deleted workspaces drop (their cells become gaps). A no-op (no write) when
   * the merge changes nothing — so an effect that tracks both the workspace
   * list and this store settles instead of looping.
   */
  sync(workspaceIds: readonly string[]): void;
  /** Resize a tile (persisted spans; render-time clamping is separate). */
  resize(id: string, colSpan: number, rowSpan: number): void;
  /**
   * Drop a tile at a specific CELL (the drag commit): the contiguous filled
   * run pushes forward from that cell (gaps absorb it), every resulting
   * position pins. See `placeAtCell`.
   */
  placeAtCell(id: string, cell: Cell, geometry: GridGeometry): void;
  /**
   * Pin (or re-pin) the tile at the FIRST EMPTY slot — the header-create
   * flow. Idempotent (see `pinAtFirstEmpty`).
   */
  placeFirstEmpty(id: string, geometry: GridGeometry): void;
  /** Re-apply the recent-activity order AND clear all pins (the reset). */
  sortByRecentActivity(lastActivityById: ReadonlyMap<string, number>): void;
}

export function createTileLayoutStore(persistence: LocalStore<TileLayoutData>): TileLayoutStore {
  // Load once at creation; a corrupt/foreign document sanitizes to empty.
  let data = $state<TileLayoutData>(sanitizeLayout(persistence.load()));

  function commit(tiles: readonly TileLayoutEntry[]): void {
    // A pure op that changed nothing (e.g. a no-op place) doesn't write.
    if (sameEntries(tiles, data.tiles)) return;
    data = { version: 2, tiles };
    persistence.save(data);
  }

  return {
    get entries(): readonly TileLayoutEntry[] {
      return data.tiles;
    },

    sync(workspaceIds): void {
      const merged = mergeLayout(data, workspaceIds);
      if (!sameEntries(merged, data.tiles)) commit(merged);
    },

    resize(id, colSpan, rowSpan): void {
      commit(resizeTile(data.tiles, id, colSpan, rowSpan));
    },

    placeAtCell(id, cell, geometry): void {
      commit(placeAtCell(data.tiles, id, cell, geometry));
    },

    placeFirstEmpty(id, geometry): void {
      commit(pinAtFirstEmpty(data.tiles, id, geometry));
    },

    sortByRecentActivity(lastActivityById): void {
      commit(sortByRecentActivity(data.tiles, lastActivityById));
    },
  };
}

/** Structural equality over entries (ids, spans, orders, anchors). */
function sameEntries(a: readonly TileLayoutEntry[], b: readonly TileLayoutEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      entry.id === other.id &&
      entry.colSpan === other.colSpan &&
      entry.rowSpan === other.rowSpan &&
      entry.order === other.order &&
      entry.col === other.col &&
      entry.row === other.row
    );
  });
}
