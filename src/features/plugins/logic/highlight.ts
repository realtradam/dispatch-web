import type { PluginNode } from "./types";

/** The two highlight sets for the §8 bidirectional dependency hover. */
export interface HighlightSets {
  /** The hovered row's DIRECT dependencies (highlighted when hovering an item). */
  readonly deps: ReadonlySet<string>;
  /** The loaded/unloaded rows that DIRECTLY depend on the hovered row
   * (highlighted when hovering a dependency). */
  readonly dependents: ReadonlySet<string>;
}

const EMPTY: HighlightSets = { deps: new Set(), dependents: new Set() };

/**
 * Bidirectional hover highlighting (§8): hover any item → its DIRECT
 * dependencies highlight; hover a dependency → its dependents highlight.
 * One hop in each direction (the plan's grammar is "its dependencies" /
 * "its dependents" — the visual neighborhood, not the transitive closure;
 * the transitive closures live in `computeCascade` / `autoCheckBackendPrereqs`).
 *
 * Works across BOTH manager tables (a loaded row can highlight an unloaded
 * dependency row and vice versa) — the node list spans the whole catalog.
 * Pure input → output; `hoveredId` null (no hover) → both sets empty.
 */
export function dependencyHighlightSets(
  hoveredId: string | null,
  nodes: readonly PluginNode[],
): HighlightSets {
  if (hoveredId === null) return EMPTY;
  const hovered = nodes.find((n) => n.id === hoveredId);
  if (hovered === undefined) return EMPTY;
  const deps = new Set(hovered.dependsOn);
  const dependents = new Set(
    nodes.filter((n) => n.id !== hoveredId && n.dependsOn.includes(hoveredId)).map((n) => n.id),
  );
  return { deps, dependents };
}
