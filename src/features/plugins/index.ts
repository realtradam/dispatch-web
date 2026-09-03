export type {
  PluginOpResult,
  PluginScanResult,
  PluginsHttp,
  WorkspaceStateResult,
} from "./adapter/http";
export { createPluginsHttp } from "./adapter/http";
export { computeCascade } from "./logic/cascade";
export type { HighlightSets } from "./logic/highlight";
export { dependencyHighlightSets } from "./logic/highlight";
export { isLastProvider, unloadBlockReason } from "./logic/last-provider";
export { autoCheckBackendPrereqs } from "./logic/prereqs";
export type { PluginNode, PluginSection } from "./logic/types";
export { TIER_ORDER, tierLabel } from "./logic/types";
export { groupByTier, pluginNodes, splitSections } from "./logic/view-model";
export { rowBlockReason, rowChecked, rowSelectable, stateLabel } from "./logic/workspace-row";
export type { PluginsStore, WorkspacePluginsView } from "./store.svelte";
export { createPluginsStore } from "./store.svelte";
export { default as PluginManager } from "./ui/PluginManager.svelte";
export { default as WorkspacePluginModal } from "./ui/WorkspacePluginModal.svelte";
