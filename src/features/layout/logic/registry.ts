/**
 * The view registry — the map from view id → component that tile leaves mount.
 *
 * Every view the renderer can place (the 14 sidebar views + chat / composer /
 * message-queue today; plugin views from plan 03 later) registers here. The
 * registry is REACTIVE (a Svelte store): plan 03's late registrations re-render
 * open dropdowns, and the tree renderer resolves leaves through it per render.
 *
 * An unknown view id in a leaf is NEVER a crash — backend-owned trees (plan 02)
 * can name views a given client lacks; the renderer shows a fallback tile.
 *
 * This module holds a small amount of reactive state by design (the plan places
 * the registry in `logic/` with Svelte-store reactivity). It is NOT decision
 * logic — no DOM, no effects.
 */

import type { Component } from "svelte";
import { type Readable, writable } from "svelte/store";

/**
 * The props type of a registered view component. The composition root hands
 * every wrapper its `ports` through this bag (see `src/app/view-ports.ts`);
 * fixture/generic components may ignore it.
 *
 * The registry is a HETEROGENEOUS component bag (the plan types it `Component`
 * outright), so its props are opaque `Record<string, any>` — the wrappers
 * re-narrow to their concrete props at the composition-root seam.
 */
export type ViewComponent =
  // biome-ignore lint/suspicious/noExplicitAny: opaque props of a heterogeneous component bag
  Component<Record<string, any>>;

export interface ViewRegistration {
  /** Registry id — the same id a leaf's `view` field names. */
  readonly id: string;
  /** Human label shown in panel dropdowns. */
  readonly label: string;
  /** Svelte 5 component, already props-wired (see `src/app/register-views.ts`). */
  readonly component: ViewComponent;
  /** Whether the view may appear in panel dropdowns (default true). */
  readonly panelEligible?: boolean;
  /** The plugin that contributed the view (plan 03 requires it for those). */
  readonly pluginId?: string;
}

/** A registered view with `panelEligible` normalized (default true). */
export interface RegisteredView {
  readonly id: string;
  readonly label: string;
  readonly component: ViewComponent;
  readonly panelEligible: boolean;
  readonly pluginId: string | undefined;
}

const byId = new Map<string, RegisteredView>();
const store = writable<readonly RegisteredView[]>([]);

function publish(): void {
  store.set([...byId.values()]);
}

/**
 * Register a view. A duplicate id throws LOUDLY at dev time — two components
 * claiming one id is a composition-root bug, never a runtime fallback case.
 */
export function registerView(registration: ViewRegistration): void {
  if (byId.has(registration.id)) {
    throw new Error(`registerView: duplicate view id "${registration.id}"`);
  }
  byId.set(registration.id, {
    id: registration.id,
    label: registration.label,
    component: registration.component,
    panelEligible: registration.panelEligible ?? true,
    pluginId: registration.pluginId,
  });
  publish();
}

/** Remove a view. Idempotent (removing an unknown id is a no-op). */
export function unregisterView(id: string): void {
  if (byId.delete(id)) publish();
}

/** Look a view up by id (undefined → the renderer shows its fallback tile). */
export function getView(id: string): RegisteredView | undefined {
  return byId.get(id);
}

/** All registered views, in registration order (snapshot). */
export function listViews(): readonly RegisteredView[] {
  return [...byId.values()];
}

/** The panel-eligible subset (`panelEligible: true`) — panel dropdown options. */
export function listPanelViews(): readonly RegisteredView[] {
  return listViews().filter((v) => v.panelEligible);
}

/**
 * Reactive registry contents (registration order). Subscribe in components —
 * e.g. `$viewRegistry` in a panel dropdown — so late registrations (plan 03)
 * re-render open dropdowns.
 */
export const viewRegistry: Readable<readonly RegisteredView[]> = {
  subscribe: store.subscribe,
};
