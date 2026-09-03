import type { PluginNode } from "./types";

/**
 * Whether unloading `targetId` would remove the LAST loaded provider — the
 * §8 hard lock (the one unload the server refuses outright, never force-able).
 * The UI disables the control with an explanatory tooltip; the server still
 * enforces the rule. Pure input → output.
 */
export function isLastProvider(targetId: string, nodes: readonly PluginNode[]): boolean {
  const target = nodes.find((n) => n.id === targetId);
  if (target === undefined || !target.loaded || target.tier !== "providers") return false;
  const loadedProviders = nodes.filter((n) => n.loaded && n.tier === "providers");
  return loadedProviders.length <= 1;
}

/**
 * Why the row's load/unload control is disabled, or null when it is
 * interactive. Composes the two client-mirrored locks:
 * - tier "core" (`locked`) → the server refuses to unload it (§3/§5);
 * - the last loaded provider → the §8 hard lock.
 * Missing rows have no control at all (handled separately by the UI).
 */
export function unloadBlockReason(targetId: string, nodes: readonly PluginNode[]): string | null {
  const target = nodes.find((n) => n.id === targetId);
  if (target === undefined) return null;
  if (target.locked) return "Core plugins cannot be unloaded — they are part of the runtime.";
  if (isLastProvider(targetId, nodes)) {
    return "Cannot unload the last provider — Dispatch needs at least one to pick models.";
  }
  return null;
}
