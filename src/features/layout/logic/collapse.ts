/**
 * Collapse chrome state — the open/closed state of the tree's collapsible
 * split children (today: the sidebar). Renderer chrome, NOT tree data
 * (layout-00 decision 3): tree nodes merely declare `collapsible`; this store
 * owns the per-node state, persisted device-locally.
 *
 * Persistence is BYTE-COMPATIBLE with today: the same `dispatch.sidebar.open`
 * key holding a JSON boolean, defaulting to open on wide screens (>= 1024px,
 * Tailwind `lg`). Today's UI has exactly one collapsible node, and the
 * persisted boolean tracks the toggled node's state — identical bytes and
 * behavior. A future with several collapsible nodes migrates the format in
 * plan 02, not here.
 */

import { type Readable, writable } from "svelte/store";

/** The localStorage key — unchanged from today (no migration). */
export const SIDEBAR_OPEN_KEY = "dispatch.sidebar.open";
/** Tailwind `lg`: today's boot default is open on wide screens. */
export const WIDE_BREAKPOINT = 1024;

export interface CollapseState {
  /** Explicit per-node open state (node id → open). Absent = the default. */
  readonly openByNode: Readonly<Record<string, boolean>>;
  /** The boot default (persisted boolean, else viewport width >= 1024). */
  readonly defaultOpen: boolean;
}

export interface CollapseStore extends Readable<CollapseState> {
  /** Is the named node open? (explicit state, else the default) */
  isOpen(nodeId: string): boolean;
  setOpen(nodeId: string, open: boolean): void;
  toggle(nodeId: string): void;
}

export interface CollapseStoreOptions {
  /** Injected storage (the app store's `Storage`; undefined → session-only). */
  readonly storage?: Storage | undefined;
  /** Viewport width at boot (today: `window.innerWidth`). Undefined → default open. */
  readonly viewportWidth?: number | undefined;
  /** Storage key override (tests). Defaults to `dispatch.sidebar.open`. */
  readonly key?: string | undefined;
}

/** The boot default: open on wide screens (narrow screens start closed). */
export function bootDefaultOpen(viewportWidth: number | undefined): boolean {
  if (viewportWidth === undefined) return true;
  return viewportWidth >= WIDE_BREAKPOINT;
}

/** Parse the persisted value. Today's format is a bare JSON boolean; anything else is ignored. */
export function parsePersistedOpen(raw: string | null): boolean | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

export function createCollapseStore(options?: CollapseStoreOptions): CollapseStore {
  const key = options?.key ?? SIDEBAR_OPEN_KEY;
  const storage = options?.storage;
  const persisted = parsePersistedOpen(storage === undefined ? null : storage.getItem(key));
  const defaultOpen = persisted ?? bootDefaultOpen(options?.viewportWidth);

  let openByNode: Record<string, boolean> = {};
  const store = writable<CollapseState>({ openByNode, defaultOpen });

  function set(nodeId: string, open: boolean): void {
    openByNode = { ...openByNode, [nodeId]: open };
    store.set({ openByNode, defaultOpen });
    // Persist the toggled node's state as today's bare boolean. With one
    // collapsible node (always, today) this is exactly today's behavior.
    if (storage !== undefined) {
      try {
        storage.setItem(key, JSON.stringify(open));
      } catch {
        // Swallow quota / write errors — persistence is best-effort.
      }
    }
  }

  function isOpen(nodeId: string): boolean {
    return openByNode[nodeId] ?? defaultOpen;
  }

  return {
    subscribe: store.subscribe,
    isOpen,
    setOpen: (nodeId, open) => set(nodeId, open),
    toggle: (nodeId) => set(nodeId, !isOpen(nodeId)),
  };
}
