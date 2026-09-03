import type { PluginTier, PluginTrustLevel } from "@dispatch/transport-contract";

/** Which manager table a plugin row belongs to (the response's row kinds). */
export type PluginSection = "loaded" | "discovered" | "missing";

/**
 * The manager's normalized view of one plugin — a single shape across the
 * `GET /plugins` response's row kinds (loaded / disabledWithReason /
 * discovered / missing) so the pure graph logic (cascade / prereqs /
 * highlight / last-provider) and the manager tables work over ONE node type.
 * Built by `pluginNodes` (`logic/view-model`) from a `PluginListResponse`.
 */
export interface PluginNode {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly tier: PluginTier;
  /** Trust level, when the row carries one (missing rows don't). */
  readonly trust: PluginTrustLevel | null;
  /** Loaded and live — the manager's checkbox reflects this. */
  readonly loaded: boolean;
  /** True for tier "core" — the server refuses to unload it (locked control). */
  readonly locked: boolean;
  /** Declared dependencies (plugin ids), possibly empty. */
  readonly dependsOn: readonly string[];
  /** Why the plugin is not loaded (disabled-with-reason) or gone (missing). */
  readonly reason: string | null;
  readonly section: PluginSection;
}

/** Display labels for the classification tiers (backend-canonical values). */
export function tierLabel(tier: PluginTier): string {
  switch (tier) {
    case "core":
      return "Core";
    case "providers":
      return "Provider";
    case "standard":
      return "Standard";
  }
}

/** Display order of the tiers within a manager table (Core first). */
export const TIER_ORDER: readonly PluginTier[] = ["core", "providers", "standard"];

/**
 * Runtime-normalize a tier value to the canonical THREE: anything that is not
 * exactly `core` | `providers` | `standard` — a missing tier, or a value
 * outside the contract ("kernel" is NOT a tier; the kernel hosts plugins, it
 * is not one) — folds into `"standard"`, the safe catch-all classification.
 * The wire contract pins the three values, so this only ever fires on a
 * contract violation (the backend rejects tierless externals at boot and
 * directory-scanned plugins fail manifest validation); folding rather than
 * surfacing the raw value keeps every tier-keyed consumer total — e.g.
 * `tierLabel`'s exhaustive switch (an out-of-contract value would render an
 * empty badge) and the manager table's keyed grouping (a non-canonical key
 * would create a second, colliding group).
 */
export function normalizeTier(tier: unknown): PluginTier {
  return tier === "core" || tier === "providers" || tier === "standard" ? tier : "standard";
}
