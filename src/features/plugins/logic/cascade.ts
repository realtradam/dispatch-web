import type { PluginNode } from "./types";

/**
 * The transitive set of LOADED dependents that would also be unloaded if
 * `targetId` were unloaded — the §8 cascade-uncheck warning's list ("unloading
 * X also unchecks Y, Z"). Client mirror of the backend's
 * `computeUnloadCascade` (plan 05): the reverse-dependency closure computed
 * over the LOADED subgraph only (an unloaded intermediate breaks the chain —
 * a loaded dependent behind it is already unmet and is not part of THIS
 * cascade). The server still enforces the real cascade; the FE computes the
 * same set to warn before the request goes out.
 *
 * Pure input → output; deterministic order (alphabetical by id) so tests and
 * renderings are stable.
 */
export function computeCascade(targetId: string, nodes: readonly PluginNode[]): readonly string[] {
  // Reverse edges within the loaded subgraph: dep id → loaded dependent ids.
  const dependentsOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.loaded) continue;
    for (const dep of node.dependsOn) {
      const list = dependentsOf.get(dep);
      if (list) list.push(node.id);
      else dependentsOf.set(dep, [node.id]);
    }
  }

  // BFS over reverse edges, collecting every reached loaded dependent.
  const out: string[] = [];
  const seen = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependentsOf.get(current) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      out.push(dependent);
      queue.push(dependent);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
