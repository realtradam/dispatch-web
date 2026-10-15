import type { NamedAgentSelectionSnapshot } from "../named-agents";
import type { Tab, TabsState } from "./tabs";
import {
  initialState,
  closeTab as reduceCloseTab,
  createTab as reduceCreateTab,
  newDraft as reduceNewDraft,
  openTab as reduceOpenTab,
  selectTab as reduceSelectTab,
  setModel as reduceSetModel,
  setSnapshot as reduceSetSnapshot,
  setTabGroupParent as reduceSetTabGroupParent,
  setTitle as reduceSetTitle,
  setWorkspaceId as reduceSetWorkspaceId,
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
  /** Add a tab WITHOUT focusing it (for `conversation.open`). No-op if already open. */
  openTab(tab: Tab): void;
  selectTab(conversationId: string): void;
  closeTab(conversationId: string): void;
  setModel(conversationId: string, model: string): void;
  /**
   * Set (or clear, with null) a tab's Named Agent snapshot (plan §7). The caller
   * keeps the snapshot's captured `model` in sync with the tab's `model`.
   */
  setSnapshot(conversationId: string, snapshot: NamedAgentSelectionSnapshot | null): void;
  setTitle(conversationId: string, title: string): void;
  setWorkspaceId(conversationId: string, workspaceId: string): void;
  /** Set (string) or clear (null) a tab's tab group parent (visual subagent group). */
  setTabGroupParent(conversationId: string, parentId: string | null): void;
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
    openTab(tab: Tab): void {
      apply(reduceOpenTab(state, tab));
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
    setSnapshot(conversationId: string, snapshot: NamedAgentSelectionSnapshot | null): void {
      apply(reduceSetSnapshot(state, conversationId, snapshot));
    },
    setTitle(conversationId: string, title: string): void {
      apply(reduceSetTitle(state, conversationId, title));
    },
    setWorkspaceId(conversationId: string, workspaceId: string): void {
      apply(reduceSetWorkspaceId(state, conversationId, workspaceId));
    },
    setTabGroupParent(conversationId: string, parentId: string | null): void {
      apply(reduceSetTabGroupParent(state, conversationId, parentId));
    },
  };
}
