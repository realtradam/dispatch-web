export type { WorkspaceHttp, WorkspaceResult } from "./adapter/http";
export { createWorkspaceHttp } from "./adapter/http";
export type { Route } from "./logic/route";
export {
	DEFAULT_WORKSPACE_ID,
	isValidSlug,
	parsePath,
	WORKSPACE_SLUG_RE,
	workspacePath,
} from "./logic/route";
export { pageTitle, relativeTime } from "./logic/view-model";
export type { WorkspaceStore } from "./store.svelte";
export { createWorkspaceStore } from "./store.svelte";
export { default as WorkspaceCard } from "./ui/WorkspaceCard.svelte";
export { default as WorkspacesHome } from "./ui/WorkspacesHome.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "workspaces",
	description: "URL-driven conversation grouping with a backend-owned default cwd",
} as const;
