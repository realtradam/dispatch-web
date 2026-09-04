/**
 * localStorage → provider migration (plan 02 §2.7, D-L4; one-way, best-effort).
 *
 * `dispatch.sidebar.views` is retired as a source of truth: on boot WITH a
 * provider present, if the key exists AND the fetched tree's `side` panels
 * equal DEFAULT_LAYOUT's (the workspace still has the untouched default
 * seed), the stored panel selection is imported once via a PUT. When the
 * provider's tree differs from the default (e.g. a calendar provider), the
 * workspace already has a custom layout — importing the old sidebar override
 * would be wrong. Regardless of outcome the key is never read again (the
 * bytes stay, but nothing consumes them).
 *
 * Pure decision logic: the store owns the effects (the localStorage read +
 * the PUT); this module decides IF and WHAT.
 */

import {
  DEFAULT_LAYOUT,
  findById,
  type LayoutTree,
  type PanelsNode,
} from "@dispatch/layout-contract";
import { overlaySidePanels } from "./seed";

/**
 * The stored selection's usable view ids: an array of strings filtered to the
 * known (registered) views, in stored order. null when nothing usable is
 * stored (absent key, junk, or no known ids) — nothing to import.
 */
export function storedPanelViews(
  raw: unknown,
  knownViews: ReadonlySet<string>,
): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  const known = raw.filter((v): v is string => typeof v === "string" && knownViews.has(v));
  return known.length > 0 ? known : null;
}

/**
 * The view ids of a tree's `"side"` panels node (the default tree's swappable
 * sidebar stack), or null when the tree has no such node.
 */
export function sidePanelViews(tree: LayoutTree): readonly string[] | null {
  const found = findById(tree, "side");
  if (found === null || found.node.kind !== "panels") return null;
  return (found.node as PanelsNode).panels.map((p) => p.view);
}

function samePanels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The one-way migration decision (§2.7): given the RAW stored value, the
 * known view ids, and the tree fetched from the provider, return the tree to
 * PUT once — or null when there is nothing to migrate:
 * - the stored key holds no usable selection, or
 * - the provider's tree is NOT the untouched default seed (its side panels
 *   differ from DEFAULT_LAYOUT's — the workspace already has a custom layout).
 */
export function migrationTree(
  storedRaw: unknown,
  knownViews: ReadonlySet<string>,
  fetched: LayoutTree,
): LayoutTree | null {
  const stored = storedPanelViews(storedRaw, knownViews);
  if (stored === null) return null;
  const fetchedPanels = sidePanelViews(fetched);
  const defaultPanels = sidePanelViews(DEFAULT_LAYOUT);
  if (fetchedPanels === null || defaultPanels === null) return null;
  if (!samePanels(fetchedPanels, defaultPanels)) return null;
  // Overlay the stored selection onto the fetched tree (identical to the
  // default here by the guard above — the seed overlay keeps the rest of the
  // tree shared, not copied).
  return overlaySidePanels(fetched, stored);
}
