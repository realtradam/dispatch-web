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
