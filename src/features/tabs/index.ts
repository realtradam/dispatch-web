export type { Tab, TabsState } from "./tabs";
export {
	activeTab,
	closeTab,
	createTab,
	deriveTitle,
	initialState,
	newDraft,
	selectTab,
	setModel,
	setTitle,
} from "./tabs";
export type { TabsStorage, TabsStore } from "./tabs-store.svelte";
export { createTabsStore } from "./tabs-store.svelte";
