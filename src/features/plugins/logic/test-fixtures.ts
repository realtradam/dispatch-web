import type { PluginListResponse } from "@dispatch/transport-contract";
import type { PluginNode } from "./types";
import { pluginNodes } from "./view-model";

/**
 * Build a PluginNode directly (the graph-logic tests' fixture). Defaults:
 * loaded, standard tier, no deps.
 */
export function node(overrides: Partial<PluginNode> = {}): PluginNode {
  return {
    id: "p",
    name: "p",
    version: "1.0.0",
    tier: "standard",
    trust: "bundled",
    loaded: true,
    locked: false,
    dependsOn: [],
    reason: null,
    section: "loaded",
    ...overrides,
  };
}

/** An empty `GET /plugins` response. */
export function emptyListResponse(): PluginListResponse {
  return { loaded: [], disabledWithReason: [], discovered: [], missing: [] };
}

export { pluginNodes };
