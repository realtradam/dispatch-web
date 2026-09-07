export type { WorkspaceHttp, WorkspaceResult } from "./adapter/http";
export { createWorkspaceHttp } from "./adapter/http";
export type {
  DragEmit,
  DragEvent as DragControllerEvent,
  DragPhase,
} from "./logic/drag-controller";
export { nextDragPhase } from "./logic/drag-controller";
export type { Route } from "./logic/route";
export {
  DEFAULT_WORKSPACE_ID,
  isValidSlug,
  parsePath,
  WORKSPACE_SLUG_RE,
  workspacePath,
} from "./logic/route";
export type {
  GridGeometry,
  Placement,
  TileGeometryMode,
  TileLayoutData,
  TileLayoutEntry,
} from "./logic/tile-layout";
export {
  clampSpan,
  fillOrderKey,
  firstEmptySlot,
  geometryFor,
  insertAtFirstEmptySlot,
  mergeLayout,
  moveTile,
  pack,
  resizeTile,
  sanitizeLayout,
  sortByRecentActivity,
  sortTiles,
} from "./logic/tile-layout";
export { applyStarred, pageTitle, relativeTime, sortWorkspaces } from "./logic/view-model";
export type { WorkspaceStore } from "./store.svelte";
export { createWorkspaceStore } from "./store.svelte";
export type { TileLayoutStore } from "./tile-layout-store.svelte";
export { createTileLayoutStore, TILE_LAYOUT_STORAGE_KEY } from "./tile-layout-store.svelte";
export { default as WorkspacesHome } from "./ui/WorkspacesHome.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "workspaces",
  description: "URL-driven conversation grouping with a backend-owned default cwd",
} as const;
