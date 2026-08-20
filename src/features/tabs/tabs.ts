import type { NamedAgentSelectionSnapshot } from "../named-agents";

export interface Tab {
  readonly conversationId: string;
  readonly model: string;
  readonly title: string;
  /** The workspace this tab belongs to (the workspace's URL slug). */
  readonly workspaceId: string;
  /**
   * The Named Agent selection snapshot, when this conversation was selected via
   * a Named Agent (plan §7). Retained so the conversation keeps showing the
   * friendly label (and its captured raw model) even after the Named Agent is
   * renamed/removed. Absent for a raw model selection.
   */
  readonly snapshot?: NamedAgentSelectionSnapshot;
}

export interface TabsState {
  readonly tabs: readonly Tab[];
  readonly activeConversationId: string | null;
}

const DEFAULT_TITLE = "New chat";
const DEFAULT_MAX_TITLE_LENGTH = 40;

export function initialState(persisted?: TabsState): TabsState {
  if (persisted !== undefined) {
    // Migrate tabs persisted before workspaces: assign them to the "default"
    // workspace (the fallback for conversations with no workspace).
    const tabs = persisted.tabs.map((t) => {
      const wid = (t as { workspaceId?: string }).workspaceId;
      return { ...t, workspaceId: wid ?? "default" };
    });
    return { tabs, activeConversationId: persisted.activeConversationId };
  }
  return { tabs: [], activeConversationId: null };
}

export function newDraft(state: TabsState): TabsState {
  return { ...state, activeConversationId: null };
}

export function createTab(state: TabsState, tab: Tab): TabsState {
  const exists = state.tabs.some((t) => t.conversationId === tab.conversationId);
  const tabs = exists ? state.tabs : [...state.tabs, tab];
  return { tabs, activeConversationId: tab.conversationId };
}

/**
 * Add a tab WITHOUT switching the active conversation — used by the
 * `conversation.open` WS broadcast (CLI `--open`): the tab appears in the
 * strip but the user stays on their current tab. No-op if already open.
 */
export function openTab(state: TabsState, tab: Tab): TabsState {
  const exists = state.tabs.some((t) => t.conversationId === tab.conversationId);
  if (exists) return state;
  return { tabs: [...state.tabs, tab], activeConversationId: state.activeConversationId };
}

export function selectTab(state: TabsState, conversationId: string): TabsState {
  return { ...state, activeConversationId: conversationId };
}

export function closeTab(state: TabsState, conversationId: string): TabsState {
  const idx = state.tabs.findIndex((t) => t.conversationId === conversationId);
  if (idx === -1) return state;

  const tabs = state.tabs.filter((t) => t.conversationId !== conversationId);

  if (state.activeConversationId !== conversationId) {
    return { tabs, activeConversationId: state.activeConversationId };
  }

  if (tabs.length === 0) {
    return { tabs, activeConversationId: null };
  }

  // prefer previous tab, else next
  const neighborIdx = idx > 0 ? idx - 1 : 0;
  const neighbor = tabs[neighborIdx];
  return { tabs, activeConversationId: neighbor?.conversationId ?? null };
}

export function setModel(state: TabsState, conversationId: string, model: string): TabsState {
  // A raw-model selection clears any Named Agent snapshot (a raw selection is
  // not "via a Named Agent"). Omit the key entirely (`exactOptionalPropertyTypes`).
  const tabs = state.tabs.map((t) =>
    t.conversationId !== conversationId ? t : omitSnapshot({ ...t, model }),
  );
  return { tabs, activeConversationId: state.activeConversationId };
}

/** Drop the optional `snapshot` key (used to clear a Named Agent selection). */
function omitSnapshot(tab: Tab): Tab {
  if (!("snapshot" in tab)) return tab;
  const { snapshot: _omit, ...rest } = tab;
  void _omit;
  return rest;
}

/**
 * Set (or clear) a tab's Named Agent selection snapshot (plan §7). The snapshot's
 * captured `model` should equal the tab's `model` (the resolved raw model); this
 * reducer does not rewrite `model` — the caller keeps them in sync. Pass `null`
 * to clear (a raw model selection).
 */
export function setSnapshot(
  state: TabsState,
  conversationId: string,
  snapshot: NamedAgentSelectionSnapshot | null,
): TabsState {
  const tabs = state.tabs.map((t) =>
    t.conversationId === conversationId ? { ...t, ...(snapshot === null ? {} : { snapshot }) } : t,
  );
  return { tabs, activeConversationId: state.activeConversationId };
}

export function setTitle(state: TabsState, conversationId: string, title: string): TabsState {
  const tabs = state.tabs.map((t) => (t.conversationId === conversationId ? { ...t, title } : t));
  return { tabs, activeConversationId: state.activeConversationId };
}

export function setWorkspaceId(
  state: TabsState,
  conversationId: string,
  workspaceId: string,
): TabsState {
  const tabs = state.tabs.map((t) =>
    t.conversationId === conversationId ? { ...t, workspaceId } : t,
  );
  return { tabs, activeConversationId: state.activeConversationId };
}

export function activeTab(state: TabsState): Tab | null {
  if (state.activeConversationId === null) return null;
  return state.tabs.find((t) => t.conversationId === state.activeConversationId) ?? null;
}

export function deriveTitle(message: string, max: number = DEFAULT_MAX_TITLE_LENGTH): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return DEFAULT_TITLE;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\u2026`;
}

/** Minimum length of a tab handle (git-style short id). */
export const MIN_HANDLE_LENGTH = 4;

/**
 * The short "handle" shown on a tab: the shortest prefix of `conversationId`
 * (at least `MIN_HANDLE_LENGTH` chars) that is unique among all open tabs — a
 * git-style short id. Grows by a char only when another open tab shares the
 * prefix, and shrinks back when that sibling closes. Pure: the id + every open
 * id in, the handle string out. (`allIds` may include `conversationId` itself.)
 */
export function shortHandle(conversationId: string, allIds: readonly string[]): string {
  const others = allIds.filter((id) => id !== conversationId);
  for (let len = MIN_HANDLE_LENGTH; len < conversationId.length; len++) {
    const candidate = conversationId.slice(0, len);
    if (!others.some((id) => id.startsWith(candidate))) return candidate;
  }
  return conversationId;
}
