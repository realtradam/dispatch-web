/**
 * Boot-time tree seeding: the default layout with today's sidebar selection
 * overlaid from localStorage. Byte-compatible with today's boot behavior
 * (`dispatch.sidebar.views` read; unknown/removed kinds dropped — the tree
 * schema has no "unknown view" panel state, so a stale id is skipped exactly
 * like a view that no longer exists).
 */

import {
  DEFAULT_LAYOUT,
  findById,
  type LayoutNode,
  type LayoutTree,
  type LeafNode,
  type PanelsNode,
  type Path,
} from "@dispatch/layout-contract";

/**
 * Today's default sidebar selection (the moved-from-top tab bar + the model
 * controls) — the fallback when nothing (or nothing valid) is stored.
 */
export const DEFAULT_PANEL_VIEWS: readonly string[] = ["tabs", "model"];

/**
 * Seed a tree from DEFAULT_LAYOUT with `storedViews` (the parsed
 * `dispatch.sidebar.views` value, or null when absent) overlaid onto the
 * default tree's panels node.
 *
 * - null / non-array / array without any known view → the defaults.
 * - Known views are kept in the stored order; unknown ids are dropped.
 */
export function seedLayout(storedViews: unknown, panelViewIds: readonly string[]): LayoutTree {
  const known = new Set(panelViewIds);
  const stored = Array.isArray(storedViews)
    ? storedViews.filter((v): v is string => typeof v === "string")
    : [];
  const panels = stored.filter((v) => known.has(v));
  const selected = panels.length > 0 ? panels : DEFAULT_PANEL_VIEWS.filter((v) => known.has(v));
  return overlaySidePanels(DEFAULT_LAYOUT, selected);
}

/**
 * A NEW tree: `base` with its `"side"` panels node replaced by leaves mounting
 * `views` (in order). Targets the panels node by id (falls back to no-op when
 * the base has none); the rest of the tree is shared, not copied.
 */
export function overlaySidePanels(base: LayoutTree, views: readonly string[]): LayoutTree {
  const found = findById(base, "side");
  if (found === null || found.node.kind !== "panels") return base;
  const panels: readonly LeafNode[] = views.map((view) => ({ kind: "leaf", view }));
  const next: PanelsNode = { ...found.node, panels };
  return { version: 1, root: replaceChild(base.root, found.path, next) };
}

/** Rebuild the node at `path` (immutably); the replacement must be a panels node. */
function replaceChild(node: LayoutNode, path: Path, replacement: PanelsNode): LayoutNode {
  if (path.length === 0) return replacement;
  const [head, ...rest] = path;
  if (typeof head !== "number") return node;
  if (node.kind === "split") {
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === head ? { ...child, node: replaceChild(child.node, rest, replacement) } : child,
      ),
    };
  }
  if (node.kind === "stack") {
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === head ? { ...child, node: replaceChild(child.node, rest, replacement) } : child,
      ),
    };
  }
  return node;
}
