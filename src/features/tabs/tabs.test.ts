import { describe, expect, it } from "vitest";
import type { Tab, TabsState } from "./tabs";
import {
	activeTab,
	closeTab,
	createTab,
	deriveTitle,
	initialState,
	isStuckToEnd,
	newDraft,
	selectTab,
	setModel,
	setTitle,
} from "./tabs";

const tab = (conversationId: string, model = "default", title = "Chat"): Tab => ({
	conversationId,
	model,
	title,
});

describe("initialState", () => {
	it("returns empty draft state when no persisted state", () => {
		const state = initialState();
		expect(state.tabs).toEqual([]);
		expect(state.activeConversationId).toBeNull();
	});

	it("returns persisted state when provided", () => {
		const persisted: TabsState = {
			tabs: [tab("c1")],
			activeConversationId: "c1",
		};
		const state = initialState(persisted);
		expect(state.tabs).toHaveLength(1);
		expect(state.activeConversationId).toBe("c1");
	});
});

describe("newDraft", () => {
	it("sets activeConversationId to null", () => {
		const state: TabsState = { tabs: [tab("c1")], activeConversationId: "c1" };
		const next = newDraft(state);
		expect(next.activeConversationId).toBeNull();
	});

	it("keeps existing tabs", () => {
		const state: TabsState = { tabs: [tab("c1"), tab("c2")], activeConversationId: "c1" };
		const next = newDraft(state);
		expect(next.tabs).toHaveLength(2);
	});
});

describe("createTab", () => {
	it("appends and activates", () => {
		const state = initialState();
		const next = createTab(state, tab("c1"));
		expect(next.tabs).toHaveLength(1);
		expect(next.tabs[0]?.conversationId).toBe("c1");
		expect(next.activeConversationId).toBe("c1");
	});

	it("does not duplicate an existing conversationId", () => {
		const state: TabsState = { tabs: [tab("c1")], activeConversationId: "c1" };
		const next = createTab(state, tab("c1"));
		expect(next.tabs).toHaveLength(1);
	});

	it("activates an already-existing tab when createTab is called again", () => {
		const state: TabsState = { tabs: [tab("c1"), tab("c2")], activeConversationId: "c2" };
		const next = createTab(state, tab("c1"));
		expect(next.activeConversationId).toBe("c1");
	});
});

describe("selectTab", () => {
	it("changes active", () => {
		const state: TabsState = { tabs: [tab("c1"), tab("c2")], activeConversationId: "c1" };
		const next = selectTab(state, "c2");
		expect(next.activeConversationId).toBe("c2");
	});
});

describe("closeTab", () => {
	it("removes the tab", () => {
		const state: TabsState = { tabs: [tab("c1"), tab("c2")], activeConversationId: "c1" };
		const next = closeTab(state, "c2");
		expect(next.tabs).toHaveLength(1);
		expect(next.tabs[0]?.conversationId).toBe("c1");
	});

	it("closing the active tab activates a neighbour (previous preferred)", () => {
		const state: TabsState = {
			tabs: [tab("c1"), tab("c2"), tab("c3")],
			activeConversationId: "c2",
		};
		const next = closeTab(state, "c2");
		expect(next.activeConversationId).toBe("c1");
	});

	it("closing the first active tab activates the next", () => {
		const state: TabsState = {
			tabs: [tab("c1"), tab("c2"), tab("c3")],
			activeConversationId: "c1",
		};
		const next = closeTab(state, "c1");
		expect(next.activeConversationId).toBe("c2");
	});

	it("closing the last tab returns to draft (null active)", () => {
		const state: TabsState = { tabs: [tab("c1")], activeConversationId: "c1" };
		const next = closeTab(state, "c1");
		expect(next.tabs).toHaveLength(0);
		expect(next.activeConversationId).toBeNull();
	});

	it("closing a non-active tab does not change active", () => {
		const state: TabsState = {
			tabs: [tab("c1"), tab("c2"), tab("c3")],
			activeConversationId: "c3",
		};
		const next = closeTab(state, "c1");
		expect(next.activeConversationId).toBe("c3");
	});

	it("closing a non-existent tab is a no-op", () => {
		const state: TabsState = { tabs: [tab("c1")], activeConversationId: "c1" };
		const next = closeTab(state, "missing");
		expect(next).toEqual(state);
	});
});

describe("setModel", () => {
	it("updates the right tab", () => {
		const state: TabsState = { tabs: [tab("c1", "old"), tab("c2")], activeConversationId: "c1" };
		const next = setModel(state, "c1", "new-model");
		expect(next.tabs[0]?.model).toBe("new-model");
		expect(next.tabs[1]?.model).toBe("default");
	});
});

describe("setTitle", () => {
	it("updates the right tab", () => {
		const state: TabsState = { tabs: [tab("c1"), tab("c2")], activeConversationId: "c1" };
		const next = setTitle(state, "c1", "Updated title");
		expect(next.tabs[0]?.title).toBe("Updated title");
		expect(next.tabs[1]?.title).toBe("Chat");
	});
});

describe("activeTab", () => {
	it("returns the active tab", () => {
		const state: TabsState = { tabs: [tab("c1"), tab("c2")], activeConversationId: "c2" };
		expect(activeTab(state)?.conversationId).toBe("c2");
	});

	it("returns null when activeConversationId is null", () => {
		const state: TabsState = { tabs: [tab("c1")], activeConversationId: null };
		expect(activeTab(state)).toBeNull();
	});

	it("returns null when active tab is not found in tabs", () => {
		const state: TabsState = { tabs: [tab("c1")], activeConversationId: "missing" };
		expect(activeTab(state)).toBeNull();
	});
});

describe("deriveTitle", () => {
	it("truncates long messages with ellipsis", () => {
		const msg = "This is a very long message that should be truncated at some point";
		expect(deriveTitle(msg, 20)).toBe("This is a very long \u2026");
	});

	it("returns full message when under max", () => {
		expect(deriveTitle("Short", 40)).toBe("Short");
	});

	it("collapses whitespace", () => {
		expect(deriveTitle("  hello   world  ")).toBe("hello world");
	});

	it("falls back to 'New chat' for empty input", () => {
		expect(deriveTitle("")).toBe("New chat");
		expect(deriveTitle("   ")).toBe("New chat");
	});

	it("uses default max of ~40 chars", () => {
		const msg = "a".repeat(50);
		const result = deriveTitle(msg);
		expect(result).toBe(`${"a".repeat(40)}\u2026`);
	});
});

describe("isStuckToEnd", () => {
	it("is false when the strip does not overflow", () => {
		expect(isStuckToEnd({ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 })).toBe(false);
		expect(isStuckToEnd({ scrollLeft: 0, clientWidth: 500, scrollWidth: 400 })).toBe(false);
	});

	it("is true when overflowing and scrolled to the left", () => {
		expect(isStuckToEnd({ scrollLeft: 0, clientWidth: 500, scrollWidth: 1000 })).toBe(true);
	});

	it("is true when overflowing and scrolled to the middle", () => {
		expect(isStuckToEnd({ scrollLeft: 250, clientWidth: 500, scrollWidth: 1000 })).toBe(true);
	});

	it("is false when overflowing but scrolled fully to the right", () => {
		expect(isStuckToEnd({ scrollLeft: 500, clientWidth: 500, scrollWidth: 1000 })).toBe(false);
	});

	it("treats a 1px subpixel gap at the end as at-rest (epsilon)", () => {
		expect(isStuckToEnd({ scrollLeft: 499, clientWidth: 500, scrollWidth: 1000 })).toBe(false);
	});
});
