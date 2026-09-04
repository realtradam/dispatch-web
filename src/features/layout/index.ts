/**
 * The layout feature — a generic tile-tree renderer + the view registry.
 *
 * The frontend stops *having* a layout and starts *rendering* one: the tree is
 * data (`@dispatch/layout-contract`), the renderer walks it, and every view a
 * leaf mounts comes from the registry. Chrome (top bar, alerts, modals) stays
 * OUTSIDE the tree — the tree owns the content region.
 */

export { createLayoutHttp, type LayoutHttp, type LayoutHttpResult } from "./adapter/http";
export {
  bootDefaultOpen,
  type CollapseState,
  type CollapseStore,
  type CollapseStoreOptions,
  createCollapseStore,
  parsePersistedOpen,
  SIDEBAR_OPEN_KEY,
  WIDE_BREAKPOINT,
} from "./logic/collapse";
export { migrationTree, sidePanelViews, storedPanelViews } from "./logic/migration";
export { addPanelOp, firstPanelView, removePanelOp, swapPanelOp } from "./logic/panels-edit";
export {
  getView,
  listPanelViews,
  listViews,
  type RegisteredView,
  registerPluginView,
  registerView,
  unregisterView,
  unregisterViewsByPlugin,
  type ViewComponent,
  type ViewRegistration,
  viewRegistry,
} from "./logic/registry";
export { DEFAULT_PANEL_VIEWS, overlaySidePanels, seedLayout } from "./logic/seed";
export { firstCollapsibleNodeId, firstPanelsNode } from "./logic/tree-query";
export { createLayoutStore, type LayoutProviderState, type LayoutStore } from "./store.svelte";
export { default as TileRoot } from "./ui/TileRoot.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "layout",
  description: "Tile-tree renderer + view registry",
} as const;
