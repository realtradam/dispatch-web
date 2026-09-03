import type { PluginNode } from "./types";

/**
 * When CHECKING (loading) `targetId`, the transitive set of its dependencies
 * that are NOT currently loaded — the plugins that must be auto-checked
 * (loaded) first (§8: "Checking a frontend plugin auto-checks its required
 * backend plugins (transitively)").
 *
 * One-directional by construction: only `dependsOn` edges FROM the target are
 * followed (frontend→backend / backend→backend). The reverse direction is
 * NEVER traversed here — backend plugins never depend on frontend ones (§8),
 * so a dependency auto-check never pulls the other way.
 *
 * Returns the ids in deterministic load order (dependencies before their
 * dependents — alphabetical within a level) so the caller can issue the load
 * requests in a safe sequence. Pure input → output.
 */
export function autoCheckBackendPrereqs(
  targetId: string,
  nodes: readonly PluginNode[],
): readonly string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // BFS over dependency edges (target → deps), collecting UNLOADED deps.
  const out: string[] = [];
  const seen = new Set<string>([targetId]);
  // Queue of [id, depth] — sorted per level so ties resolve alphabetically.
  let frontier: string[] = [targetId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = byId.get(id);
      for (const dep of node?.dependsOn ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        next.push(dep);
        if (!byId.get(dep)?.loaded) out.push(dep);
      }
    }
    frontier = next.sort((a, b) => a.localeCompare(b));
  }
  // Load order: dependencies before dependents (BFS level order already is),
  // alphabetical within a level.
  return out;
}
