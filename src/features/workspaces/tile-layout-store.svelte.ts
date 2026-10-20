import type {
  TileLayoutData as ContractTileLayoutData,
  TileGeometryMode,
} from "@dispatch/tile-layout-contract";
import { createLocalStore } from "../../adapters/local-storage";
import type { TileLayoutHttp } from "./adapter/tile-layout-http";
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
 * Tile-layout store — the synced arrangement of the home grid, ONE shared
 * document PER device orientation (`wide` = landscape/desktop, `tall` =
 * portrait/mobile), persisted through the INJECTED `TileLayoutHttp` edge
 * (the `home-tile-layout` plugin's well-known routes). Mirrors the layout
 * feature's store semantics:
 *
 * - **Orientation selection** — `setMode(mode)` (the home page's effect on
 *   the resolved grid geometry) is the boot + orientation-change trigger:
 *   an orientation CHANGE seeds from its cached server layout and probes that
 *   orientation's document fresh. Same-mode calls are a no-op. The store
 *   probes its INITIAL mode on creation (the boot probe).
 * - **Server-backed** — a successful probe applies the server document;
 *   edits apply locally IMMEDIATELY, then PUT the whole document (decision 7
 *   — no patch protocol) lightly debounced; a failed PUT on a present
 *   backend rolls back to the last server document with a quiet console
 *   warning (never an error UI).
 * - **WS push** — `onServerTileLayout(mode, data)` applies a `tile-layout`
 *   broadcast, ignoring the OTHER orientation (the server fans out to all
 *   clients; the client filters by mode).
 * - **Quiet degrade** — any probe/write failure (backend unreachable, routes
 *   not served) keeps the local state with EPHEMERAL edits (in-memory only —
 *   only server-confirmed layouts are cached); logged once, no error UI.
 * - **Sync gating** — `sync(ids)` no-ops while the first probe for an
 *   orientation is in flight (`providerState === "unknown"`): merging the
 *   live workspace list into an unprobed empty document would PUT a wiped
 *   arrangement. The caller's effect re-runs when the state settles.
 *
 * No ambient state: one instance per home page, created by the page entry
 * (or injected in tests).
 */

/** Whether the backend is serving the active orientation's document. */
export type TileLayoutProviderState = "unknown" | "present" | "absent";

export interface TileLayoutStore {
  /** The persisted entries of the ACTIVE orientation, order-sorted. */
  readonly entries: readonly TileLayoutEntry[];
  /** The active orientation (the home page's resolved grid geometry mode). */
  readonly mode: TileGeometryMode;
  /** The backend's serving state for the ACTIVE orientation. */
  readonly providerState: TileLayoutProviderState;
  /**
   * Select the active orientation and probe its document. Same-mode calls
   * are a no-op (the boot probe fires on creation for the initial mode);
   * an orientation CHANGE seeds from its cache + probes fresh.
   */
  setMode(mode: TileGeometryMode): void;
  /** Re-probe the ACTIVE orientation's document (reconnect catch-up). */
  probe(): Promise<void>;
  /** Server `tile-layout` broadcast. Other orientations are ignored. */
  onServerTileLayout(mode: TileGeometryMode, data: ContractTileLayoutData): void;
  /**
   * Merge the live workspace ids into the layout: workspaces unknown to the
   * layout append (unpinned — they flow to the first free cells), entries for
   * deleted workspaces drop (their cells become gaps). A no-op (no write)
   * when the merge changes nothing — so an effect that tracks both the
   * workspace list and this store settles instead of looping.
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

export interface TileLayoutStoreOptions {
  /** The injected HTTP edge (the `home-tile-layout` plugin's routes). */
  readonly http: TileLayoutHttp;
  /** Initial viewport orientation (default wide). */
  readonly initialMode?: TileGeometryMode;
  /** Injected localStorage for server-layout snapshots; absent → no cache. */
  readonly storage?: Storage | undefined;
  /** Edit-PUT debounce window in ms (default 300; tests shrink it). */
  readonly debounceMs?: number;
  /** The quiet-failure hook (default `console.warn` — never an error UI). */
  readonly warn?: (message: string) => void;
}

const DEFAULT_DEBOUNCE_MS = 300;

export function createTileLayoutStore(opts: TileLayoutStoreOptions): TileLayoutStore {
  const http = opts.http;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const warn = opts.warn ?? ((message: string) => console.warn(message));

  const cache = {
    wide: createLocalStore<TileLayoutData>("dispatch.tile-layout.wide", { storage: opts.storage }),
    tall: createLocalStore<TileLayoutData>("dispatch.tile-layout.tall", { storage: opts.storage }),
  };
  const initialMode = opts.initialMode ?? "wide";
  let mode = $state<TileGeometryMode>(initialMode);
  // The ACTIVE orientation's document — the server's copy once a probe has
  // landed (sanitized defensively; the backend validates strictly), the
  // cached server snapshot (or empty default) until then. Never PUT the seed.
  let data = $state<TileLayoutData>(sanitizeLayout(cache[initialMode].load()));
  let providerState = $state<TileLayoutProviderState>("unknown");

  /** The last document known to come from the server (GET / WS push / PUT echo) — the rollback target. */
  let lastServerLayout: TileLayoutData | null = null;
  /** The pending edit-PUT timer (the "lightly debounced" write). */
  let putTimer: ReturnType<typeof setTimeout> | null = null;
  /** Logged-once guard for the degrade log (reset when the backend returns). */
  let loggedAbsent = false;

  function noteAbsent(reason: string): void {
    providerState = "absent";
    if (!loggedAbsent) {
      loggedAbsent = true;
      warn(
        `tile-layout: backend not serving the layout (${reason}) — rendering the local default; edits are ephemeral`,
      );
    }
  }

  function notePresent(): void {
    providerState = "present";
    loggedAbsent = false;
  }

  function applyServerLayout(next: TileLayoutData): void {
    lastServerLayout = next;
    data = next;
    cache[mode].save(next);
  }

  function clearPutTimer(): void {
    if (putTimer !== null) {
      clearTimeout(putTimer);
      putTimer = null;
    }
  }

  async function flushPut(): Promise<void> {
    putTimer = null;
    // Read the CURRENT document at fire time: a newer edit supersedes the
    // debounced snapshot (one in-flight write per window, last wins).
    const writtenMode = mode;
    const result = await http.putLayout(writtenMode, { version: 2, tiles: data.tiles });
    if (result.ok) cache[writtenMode].save(sanitizeLayout(result.layout));
    if (writtenMode !== mode) return;
    if (result.ok) {
      notePresent();
      // The server's validated echo is the new rollback target.
      lastServerLayout = sanitizeLayout(result.layout);
      return;
    }
    if (providerState !== "present") {
      // The backend is gone (or never was): keep the local edit (ephemeral),
      // no rollback — there is no server document to roll back TO.
      noteAbsent(result.error);
      return;
    }
    // A failed write on a PRESENT backend: roll back to the last server
    // document, quiet console warning (never an error UI).
    warn(
      `tile-layout: persisting the layout failed (${result.error}) — rolled back to the last server document`,
    );
    if (lastServerLayout !== null) data = lastServerLayout;
  }

  async function runProbe(): Promise<void> {
    // Capture the mode AT START: a setMode may happen while the fetch is in
    // flight — only the CURRENT mode's result may land (the reset in
    // setMode already staged the fresh default; a stale response must never
    // overwrite it).
    const probed = mode;
    const result = await http.getLayout(mode);
    if (probed !== mode) return;
    if (result.ok) {
      notePresent();
      applyServerLayout(sanitizeLayout(result.layout));
    } else {
      // A real failure (5xx, 404 = routes not served, malformed, network)
      // degrades quietly — the local default keeps rendering.
      noteAbsent(result.error);
    }
  }

  function commit(tiles: readonly TileLayoutEntry[]): void {
    // A pure op that changed nothing (e.g. a no-op place) doesn't write.
    if (sameEntries(tiles, data.tiles)) return;
    data = { version: 2, tiles };
    if (providerState === "unknown") return; // first probe still in flight
    if (providerState === "absent") return; // ephemeral — no write, no warning
    clearPutTimer();
    putTimer = setTimeout(() => {
      void flushPut().catch(() => {
        // Network-grade failure: roll back to the last server document, quietly.
        warn("tile-layout: persisting the layout failed — rolled back to the last server document");
        if (lastServerLayout !== null) data = lastServerLayout;
      });
    }, debounceMs);
  }

  // Boot probe for the initial mode — the home page's setMode effect either
  // confirms it (no-op) or switches it (fresh probe).
  void runProbe();

  return {
    get entries(): readonly TileLayoutEntry[] {
      return data.tiles;
    },
    get mode(): TileGeometryMode {
      return mode;
    },
    get providerState(): TileLayoutProviderState {
      return providerState;
    },

    setMode(next) {
      if (next === mode) return;
      mode = next;
      // The document belongs to the OLD orientation now: seed from this
      // mode's cache while the probe resolves (never flash the other
      // orientation's arrangement), and drop any queued edit.
      clearPutTimer();
      lastServerLayout = null;
      data = sanitizeLayout(cache[mode].load());
      providerState = "unknown";
      void runProbe();
    },

    async probe() {
      await runProbe();
    },

    onServerTileLayout(pushMode, next) {
      if (pushMode !== mode) return; // clients filter by orientation
      notePresent();
      clearPutTimer(); // the server's copy supersedes any queued edit
      applyServerLayout(sanitizeLayout(next));
    },

    sync(workspaceIds): void {
      // Never merge into an UNPROBED empty document: before the first probe
      // resolves, "empty" is our placeholder, not a real arrangement — and
      // merging live ids into it could PUT a wiped layout. The caller's
      // effect re-runs when the state settles (it tracks providerState).
      if (providerState === "unknown") return;
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
