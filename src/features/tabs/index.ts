export type { Tab, TabsState } from "./tabs";
export {
	activeTab,
	closeTab,
	createTab,
	deriveTitle,
	initialState,
	MIN_HANDLE_LENGTH,
	newDraft,
	selectTab,
	setModel,
	setTitle,
	shortHandle,
} from "./tabs";
export type { TabsStorage, TabsStore } from "./tabs-store.svelte";
export { createTabsStore } from "./tabs-store.svelte";
export { default as TabBar } from "./ui/TabBar.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "tabs",
	description: "Conversation tabs with title derivation and persistence",
} as const;
