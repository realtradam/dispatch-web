export {
	addPanel,
	initialPanels,
	type PanelsState,
	removePanel,
	selectKind,
	type ViewPanel,
} from "./logic/panels";
export { default as ViewSidebar } from "./ui/ViewSidebar.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "views",
	description: "Sidebar view panels (dropdown picker + add / remove)",
} as const;
