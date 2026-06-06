import type { Tab, TabsState } from "./tabs";
import {
	initialState,
	closeTab as reduceCloseTab,
	createTab as reduceCreateTab,
	newDraft as reduceNewDraft,
	selectTab as reduceSelectTab,
	setModel as reduceSetModel,
	setTitle as reduceSetTitle,
	activeTab as selectActiveTab,
} from "./tabs";

export interface TabsStorage {
	load(): TabsState | null;
	save(state: TabsState): void;
}

export interface TabsStore {
	readonly tabs: readonly Tab[];
	readonly activeConversationId: string | null;
	readonly activeTab: Tab | null;
	newDraft(): void;
	createTab(tab: Tab): void;
	selectTab(conversationId: string): void;
	closeTab(conversationId: string): void;
	setModel(conversationId: string, model: string): void;
	setTitle(conversationId: string, title: string): void;
}

export function createTabsStore(storage: TabsStorage): TabsStore {
	let state = $state<TabsState>(storage.load() ?? initialState());

	function apply(next: TabsState): void {
		state = next;
		storage.save(next);
	}

	return {
		get tabs(): readonly Tab[] {
			return state.tabs;
		},
		get activeConversationId(): string | null {
			return state.activeConversationId;
		},
		get activeTab(): Tab | null {
			return selectActiveTab(state);
		},
		newDraft(): void {
			apply(reduceNewDraft(state));
		},
		createTab(tab: Tab): void {
			apply(reduceCreateTab(state, tab));
		},
		selectTab(conversationId: string): void {
			apply(reduceSelectTab(state, conversationId));
		},
		closeTab(conversationId: string): void {
			apply(reduceCloseTab(state, conversationId));
		},
		setModel(conversationId: string, model: string): void {
			apply(reduceSetModel(state, conversationId, model));
		},
		setTitle(conversationId: string, title: string): void {
			apply(reduceSetTitle(state, conversationId, title));
		},
	};
}
