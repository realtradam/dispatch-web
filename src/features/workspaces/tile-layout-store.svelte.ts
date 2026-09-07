import type { LocalStore } from "../../adapters/local-storage";
import {
  type GridGeometry,
  insertAtFirstEmptySlot,
  mergeLayout,
  moveTile,
  resizeTile,
  sanitizeLayout,
  sortByRecentActivity,
  type TileLayoutData,
  type TileLayoutEntry,
} from "./logic/tile-layout";

/**
 * The localStorage key for the home tile layout (order + spans only — never
 * positions; positions re-derive from the geometry on every render).
 */
export const TILE_LAYOUT_STORAGE_KEY = "dispatch.workspaces.tiles";

/**
 * Tile-layout store — a thin reactive wrapper over the persisted
 * orientation-independent layout document, persisted through the INJECTED
 * `LocalStore` adapter (the repo's local-storage effect). All mutations go
 * through the pure `logic/tile-layout` ops and write through to persistence.
 * No ambient state: one instance per home page, created by the page entry
 * (or injected in tests).
 */
export interface TileLayoutStore {
  /** The persisted entries, order-sorted (raw spans — NOT geometry-clamped). */
  readonly entries: readonly TileLayoutEntry[];
  /**
   * Merge the live workspace ids into the layout: workspaces unknown to the
   * layout append at the end, entries for deleted workspaces drop. A no-op
   * (no write) when the merge changes nothing — so an effect that tracks both
   * the workspace list and this store settles instead of looping.
   */
  sync(workspaceIds: readonly string[]): void;
  /** Resize a tile (persisted spans; render-time clamping is separate). */
  resize(id: string, colSpan: number, rowSpan: number): void;
  /** Move a tile to a position in the manual order (drag reorder). */
  move(id: string, toIndex: number): void;
  /**
   * Place (or move an already-present) tile into the FIRST EMPTY SLOT in the
   * grid's fill order — the header-create flow. Idempotent (see
   * `insertAtFirstEmptySlot`), closing the refresh race where `sync` appended
   * the id first.
   */
  placeFirstEmpty(id: string, geometry: GridGeometry): void;
  /** Re-apply the recent-activity order (the header overflow "Sort" action). */
  sortByRecentActivity(lastActivityById: ReadonlyMap<string, number>): void;
}

export function createTileLayoutStore(persistence: LocalStore<TileLayoutData>): TileLayoutStore {
  // Load once at creation; a corrupt/foreign document sanitizes to empty.
  let data = $state<TileLayoutData>(sanitizeLayout(persistence.load()));

  function commit(tiles: readonly TileLayoutEntry[]): void {
    data = { version: 1, tiles };
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

    move(id, toIndex): void {
      commit(moveTile(data.tiles, id, toIndex));
    },

    placeFirstEmpty(id, geometry): void {
      commit(insertAtFirstEmptySlot(data.tiles, id, geometry));
    },

    sortByRecentActivity(lastActivityById): void {
      commit(sortByRecentActivity(data.tiles, lastActivityById));
    },
  };
}

/** Structural equality over entries (ids, spans, orders). */
function sameEntries(a: readonly TileLayoutEntry[], b: readonly TileLayoutEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      entry.id === other.id &&
      entry.colSpan === other.colSpan &&
      entry.rowSpan === other.rowSpan &&
      entry.order === other.order
    );
  });
}
