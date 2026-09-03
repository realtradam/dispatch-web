import type { PluginListResponse } from "@dispatch/transport-contract";
import { normalizeTier, type PluginNode, type PluginSection, TIER_ORDER } from "./types";

/**
 * Normalize a `GET /plugins` response into the flat `PluginNode` list the
 * manager tables + graph logic consume. Each response row kind maps to a
 * node:
 * - `loaded` → section "loaded" (`loaded: true`, `locked` from the row —
 *   tier "core" is always locked);
 * - `disabledWithReason` → section "discovered" with the refusal `reason`
 *   (present on disk, refused/failed — greyed rows with a visible why);
 * - `discovered` → section "discovered" (`loaded: false`, unchecked);
 * - `missing` → section "missing" (override record whose directory is gone).
 *
 * Pure input → output; zero DOM/fetch.
 */
export function pluginNodes(response: PluginListResponse): readonly PluginNode[] {
  const nodes: PluginNode[] = [];
  for (const row of response.loaded) {
    nodes.push({
      id: row.id,
      name: row.name,
      version: row.version,
      // Normalize at the boundary: a missing/out-of-contract tier (backend
      // bug, stale contract) folds into "standard" so every node's tier is
      // canonical and the tier-keyed consumers below stay total.
      tier: normalizeTier(row.tier),
      trust: row.trust,
      loaded: true,
      locked: row.locked,
      dependsOn: row.dependsOn,
      reason: null,
      section: "loaded",
    });
  }
  for (const row of response.disabledWithReason) {
    nodes.push({
      id: row.id,
      name: row.name,
      version: row.version,
      tier: normalizeTier(row.tier),
      trust: row.trust,
      loaded: false,
      locked: false,
      dependsOn: [],
      reason: row.reason,
      section: "discovered",
    });
  }
  for (const row of response.discovered) {
    nodes.push({
      id: row.id,
      name: row.name,
      version: row.version,
      tier: normalizeTier(row.tier),
      trust: row.trust,
      loaded: false,
      locked: false,
      dependsOn: [],
      reason: null,
      section: "discovered",
    });
  }
  for (const row of response.missing) {
    nodes.push({
      id: row.id,
      name: row.id,
      version: "",
      tier: "standard",
      trust: null,
      loaded: false,
      locked: false,
      dependsOn: [],
      reason: row.reason ?? "directory is gone",
      section: "missing",
    });
  }
  return nodes;
}

/**
 * Cluster nodes for one manager table: tier groups in display order (Core →
 * Providers → Standard), each tier's rows sorted by id. Tiers with no rows
 * are omitted. Used by the loaded table's tier grouping (plan 07 §7.2).
 *
 * Duplicate-key-proof BY CONSTRUCTION: nodes are bucketed through a Map keyed
 * by the NORMALIZED tier, so each of the three canonical tiers can yield at
 * most one group — `PluginTable.svelte` renders a keyed each
 * (`{#each groups as group (group.tier)}`), and a duplicate key throws
 * `each_key_duplicate` in Svelte 5, aborting the whole manager render. The
 * normalization also means an unknown/missing tier (contract violation — the
 * backend rejects tierless externals at boot and directory scans fail
 * validation) folds into the `standard` bucket instead of forming a separate
 * trailing group; the old fallback (`rest[0]?.tier ?? "standard"`) produced a
 * DUPLICATE `standard` key when canonical standard rows were present.
 * groupByTier normalizes on the way in even though `pluginNodes` already
 * does at the boundary — it is exported and must be safe for any caller.
 */
export function groupByTier(
  nodes: readonly PluginNode[],
): ReadonlyArray<{ readonly tier: PluginNode["tier"]; readonly rows: readonly PluginNode[] }> {
  const byTier = new Map<PluginNode["tier"], PluginNode[]>();
  for (const n of nodes) {
    const tier = normalizeTier(n.tier);
    const rows = byTier.get(tier);
    if (rows) rows.push(n);
    else byTier.set(tier, [n]);
  }
  const out: { tier: PluginNode["tier"]; rows: PluginNode[] }[] = [];
  for (const tier of TIER_ORDER) {
    const rows = byTier.get(tier);
    if (!rows || rows.length === 0) continue;
    out.push({ tier, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return out;
}

/** Split nodes into the manager's two tables + the missing strip. */
export function splitSections(nodes: readonly PluginNode[]): {
  readonly loaded: readonly PluginNode[];
  readonly discovered: readonly PluginNode[];
  readonly missing: readonly PluginNode[];
} {
  const bySection = (section: PluginSection): PluginNode[] =>
    nodes.filter((n) => n.section === section);
  return {
    loaded: bySection("loaded"),
    discovered: bySection("discovered"),
    missing: bySection("missing"),
  };
}
