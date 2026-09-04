/**
 * Panel-edit → tree-op mapping: the pure decision logic behind TilePanels'
 * dropdown swap / add / remove buttons. The component builds the ops; the
 * renderer's owner (TileRoot → onTreeChange) applies them. Zero Svelte, zero
 * DOM.
 */

import type { LayoutOp, Path } from "@dispatch/layout-contract";

/** Swap the view a panel leaf mounts (panel `index` of the panels node at `path`). */
export function swapPanelOp(path: Path, index: number, view: string): LayoutOp {
  return { type: "replaceView", target: [...path, index], view };
}

/** Add a panel mounting `view` (appended to the panels node at `path`). */
export function addPanelOp(path: Path, view: string): LayoutOp {
  return { type: "insertPanel", panels: path, view };
}

/** Remove the panel at `index` from the panels node at `path`. */
export function removePanelOp(path: Path, index: number): LayoutOp {
  return { type: "removeNode", target: [...path, index] };
}

/**
 * The view a new panel starts with. The tree schema has no "empty panel"
 * state (a leaf's `view` is required — today's "Select a view" placeholder has
 * no tree representation), so the + button pre-selects the first panel-eligible
 * view. Returns null when nothing is eligible (the + button hides).
 */
export function firstPanelView(views: readonly { readonly id: string }[]): string | null {
  return views[0]?.id ?? null;
}
