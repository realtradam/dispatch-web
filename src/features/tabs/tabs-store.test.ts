import { describe, expect, it } from "vitest";
import type { TabsState } from "./tabs";
import type { TabsStorage } from "./tabs-store.svelte";
import { createTabsStore } from "./tabs-store.svelte";

function createMemoryStorage(initial?: TabsState): TabsStorage & { data: TabsState | null } {
	let data: TabsState | null = initial ?? null;
	return {
		get data() {
			return data;
		},
		set data(v: TabsState | null) {
			data = v;
		},
		load() {
			return data;
		},
		save(state: TabsState) {
			data = state;
		},
	};
}

describe("createTabsStore", () => {
	it("loads persisted state on construct", () => {
		const persisted: TabsState = {
			tabs: [{ conversationId: "c1", model: "m1", title: "T1" }],
			activeConversationId: "c1",
		};
		const storage = createMemoryStorage(persisted);
		const store = createTabsStore(storage);

		expect(store.tabs).toHaveLength(1);
		expect(store.activeConversationId).toBe("c1");
		expect(store.activeTab?.conversationId).toBe("c1");
	});

	it("starts with empty draft when no persisted state", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		expect(store.tabs).toHaveLength(0);
		expect(store.activeConversationId).toBeNull();
		expect(store.activeTab).toBeNull();
	});

	it("saves after every mutation", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "T1" });
		expect(storage.data?.tabs).toHaveLength(1);
		expect(storage.data?.activeConversationId).toBe("c1");

		store.createTab({ conversationId: "c2", model: "m2", title: "T2" });
		expect(storage.data?.tabs).toHaveLength(2);

		store.selectTab("c1");
		expect(storage.data?.activeConversationId).toBe("c1");

		store.closeTab("c1");
		expect(storage.data?.tabs).toHaveLength(1);
		expect(storage.data?.activeConversationId).toBe("c2");

		store.setModel("c2", "new-model");
		expect(storage.data?.tabs[0]?.model).toBe("new-model");

		store.setTitle("c2", "New Title");
		expect(storage.data?.tabs[0]?.title).toBe("New Title");

		store.newDraft();
		expect(storage.data?.activeConversationId).toBeNull();
	});

	it("createTab appends and activates", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "T1" });
		expect(store.tabs).toHaveLength(1);
		expect(store.activeConversationId).toBe("c1");

		store.createTab({ conversationId: "c2", model: "m2", title: "T2" });
		expect(store.tabs).toHaveLength(2);
		expect(store.activeConversationId).toBe("c2");
	});

	it("selectTab changes active", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "T1" });
		store.createTab({ conversationId: "c2", model: "m2", title: "T2" });

		store.selectTab("c1");
		expect(store.activeConversationId).toBe("c1");
	});

	it("closeTab removes and activates neighbour", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "T1" });
		store.createTab({ conversationId: "c2", model: "m2", title: "T2" });
		store.createTab({ conversationId: "c3", model: "m3", title: "T3" });

		store.selectTab("c2");
		store.closeTab("c2");
		expect(store.tabs).toHaveLength(2);
		expect(store.activeConversationId).toBe("c1");
	});

	it("closing the last tab returns to draft", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "T1" });
		store.closeTab("c1");
		expect(store.tabs).toHaveLength(0);
		expect(store.activeConversationId).toBeNull();
	});

	it("setModel updates the right tab", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "old", title: "T1" });
		store.createTab({ conversationId: "c2", model: "m2", title: "T2" });

		store.setModel("c1", "new-model");
		expect(store.tabs[0]?.model).toBe("new-model");
		expect(store.tabs[1]?.model).toBe("m2");
	});

	it("setTitle updates the right tab", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "Old" });

		store.setTitle("c1", "New Title");
		expect(store.tabs[0]?.title).toBe("New Title");
	});

	it("newDraft clears active but keeps tabs", () => {
		const storage = createMemoryStorage();
		const store = createTabsStore(storage);

		store.createTab({ conversationId: "c1", model: "m1", title: "T1" });
		store.createTab({ conversationId: "c2", model: "m2", title: "T2" });

		store.newDraft();
		expect(store.tabs).toHaveLength(2);
		expect(store.activeConversationId).toBeNull();
		expect(store.activeTab).toBeNull();
	});
});
