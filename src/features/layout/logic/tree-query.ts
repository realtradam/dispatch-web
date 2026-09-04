/**
 * Tree queries the chrome needs — pure walks over the layout tree.
 */

import type { LayoutNode, LayoutTree, PanelsNode, Path } from "@dispatch/layout-contract";

/** The first panels node in the tree (the panel-selection owner), if any. */
export function firstPanelsNode(tree: LayoutTree): { node: PanelsNode; path: Path } | null {
  const seen: { node: PanelsNode; path: Path }[] = [];
  const visit = (node: LayoutNode, path: Path): void => {
    if (seen.length > 0) return;
    if (node.kind === "panels") {
      seen.push({ node, path });
      return;
    }
    const kids: readonly LayoutNode[] =
      node.kind === "split"
        ? node.children.map((c) => c.node)
        : node.kind === "stack"
          ? node.children.map((c) => c.node)
          : [];
    for (const [i, child] of kids.entries()) visit(child, [...path, i]);
  };
  visit(tree.root, []);
  return seen[0] ?? null;
}

/**
 * The node id of the tree's FIRST collapsible split child — the one the chrome
 * top bar's toggle reads/writes (`findById("side")` on the default tree;
 * generically the first collapsible child, root-first then titlebar). Falls
 * back to a path-derived key when the child's node has no id. Null → the tree
 * has nothing collapsible (the toggle button hides).
 */
export function firstCollapsibleNodeId(tree: LayoutTree): string | null {
  const visit = (node: LayoutNode, path: Path): string | null => {
    if (node.kind === "split") {
      for (const [i, child] of node.children.entries()) {
        if (!child.collapsible) continue;
        if (child.node.id !== undefined) return child.node.id;
        return [...path, i].map((s) => String(s)).join(":");
      }
    }
    const kids: readonly LayoutNode[] =
      node.kind === "split"
        ? node.children.map((c) => c.node)
        : node.kind === "stack"
          ? node.children.map((c) => c.node)
          : [];
    for (const [i, child] of kids.entries()) {
      const found = visit(child, [...path, i]);
      if (found !== null) return found;
    }
    return null;
  };
  const inRoot = visit(tree.root, []);
  if (inRoot !== null) return inRoot;
  if (tree.titlebar !== undefined) return visit(tree.titlebar, ["titlebar"]);
  return null;
}
