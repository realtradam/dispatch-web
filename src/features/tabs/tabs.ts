export interface Tab {
	readonly conversationId: string;
	readonly model: string;
	readonly title: string;
}

export interface TabsState {
	readonly tabs: readonly Tab[];
	readonly activeConversationId: string | null;
}

const DEFAULT_TITLE = "New chat";
const DEFAULT_MAX_TITLE_LENGTH = 40;

export function initialState(persisted?: TabsState): TabsState {
	if (persisted !== undefined) return persisted;
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
	const tabs = state.tabs.map((t) => (t.conversationId === conversationId ? { ...t, model } : t));
	return { tabs, activeConversationId: state.activeConversationId };
}

export function setTitle(state: TabsState, conversationId: string, title: string): TabsState {
	const tabs = state.tabs.map((t) => (t.conversationId === conversationId ? { ...t, title } : t));
	return { tabs, activeConversationId: state.activeConversationId };
}

export function activeTab(state: TabsState): Tab | null {
	if (state.activeConversationId === null) return null;
	return state.tabs.find((t) => t.conversationId === state.activeConversationId) ?? null;
}

export interface ScrollMetrics {
	readonly scrollLeft: number;
	readonly clientWidth: number;
	readonly scrollWidth: number;
}

const STUCK_EPSILON = 1;

/**
 * True when a right-pinned sticky element is floating over scrolled content — the
 * strip overflows horizontally AND is not scrolled fully to the right. When it is
 * at rest (no overflow, or scrolled to the end so it sits at its natural position)
 * this returns false. Pure: layout measurements in, boolean out.
 */
export function isStuckToEnd(m: ScrollMetrics): boolean {
	const overflows = m.scrollWidth > m.clientWidth + STUCK_EPSILON;
	const notAtEnd = m.scrollLeft + m.clientWidth < m.scrollWidth - STUCK_EPSILON;
	return overflows && notAtEnd;
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
