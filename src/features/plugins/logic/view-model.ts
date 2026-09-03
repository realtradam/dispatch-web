import type { PluginListResponse } from "@dispatch/transport-contract";
import { type PluginNode, type PluginSection, TIER_ORDER } from "./types";

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
      tier: row.tier,
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
      tier: row.tier,
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
      tier: row.tier,
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
 */
export function groupByTier(
  nodes: readonly PluginNode[],
): ReadonlyArray<{ readonly tier: PluginNode["tier"]; readonly rows: readonly PluginNode[] }> {
  const out: { tier: PluginNode["tier"]; rows: PluginNode[] }[] = [];
  for (const tier of TIER_ORDER) {
    const rows = nodes.filter((n) => n.tier === tier).sort((a, b) => a.id.localeCompare(b.id));
    if (rows.length > 0) out.push({ tier, rows });
  }
  // Any tier outside TIER_ORDER (defensive — the contract pins three values).
  const known = new Set<PluginNode["tier"]>(TIER_ORDER);
  const rest = nodes.filter((n) => !known.has(n.tier)).sort((a, b) => a.id.localeCompare(b.id));
  if (rest.length > 0) out.push({ tier: rest[0]?.tier ?? "standard", rows: rest });
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
