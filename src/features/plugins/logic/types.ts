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
