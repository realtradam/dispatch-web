import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Tab } from "./tabs";
import TabBar from "./ui/TabBar.svelte";

const sampleTabs: readonly Tab[] = [
	{ conversationId: "c1", model: "openai/gpt-4", title: "First" },
	{ conversationId: "c2", model: "anthropic/claude-3", title: "Second" },
	{ conversationId: "c3", model: "google/gemini", title: "Third" },
];

describe("TabBar", () => {
	it("renders one role=tab element per tab showing each title", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		const tabs = screen.getAllByRole("tab");
		expect(tabs).toHaveLength(sampleTabs.length);
		expect(tabs[0]).toHaveTextContent("First");
		expect(tabs[1]).toHaveTextContent("Second");
		expect(tabs[2]).toHaveTextContent("Third");
	});

	it("applies tab-active to the active tab only", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c2",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		const tabs = screen.getAllByRole("tab");
		expect(tabs[0]).not.toHaveClass("tab-active");
		expect(tabs[1]).toHaveClass("tab-active");
		expect(tabs[2]).not.toHaveClass("tab-active");
	});

	it("applies tab-active to New chat button when activeConversationId is null", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: null,
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		const newChat = screen.getByRole("button", { name: "New chat" });
		expect(newChat).toHaveClass("tab-active");
	});

	it("calls onSelect with the conversationId when a tab is clicked", async () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();

		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect,
				onClose,
				onNewDraft: vi.fn(),
			},
		});

		const tabs = screen.getAllByRole("tab");
		const secondTab = tabs[1];
		if (!secondTab) throw new Error("second tab not found");
		await user.click(secondTab);

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith("c2");
		expect(onClose).not.toHaveBeenCalled();
	});

	it("calls onClose when the close button is clicked and does not call onSelect", async () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();

		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect,
				onClose,
				onNewDraft: vi.fn(),
			},
		});

		const closeButtons = screen.getAllByRole("button", { name: "Close tab" });
		const firstClose = closeButtons[0];
		if (!firstClose) throw new Error("first close button not found");
		await user.click(firstClose);

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledWith("c1");
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("calls onNewDraft when the New chat button is clicked", async () => {
		const onNewDraft = vi.fn();
		const user = userEvent.setup();

		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft,
			},
		});

		const newChat = screen.getByRole("button", { name: "New chat" });
		await user.click(newChat);

		expect(onNewDraft).toHaveBeenCalledTimes(1);
	});

	it("the New chat button has the sticky class", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		const newChat = screen.getByRole("button", { name: "New chat" });
		expect(newChat).toHaveClass("sticky");
	});

	it("shows visible 'New Chat' text when activeConversationId is null", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: null,
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		const newChat = screen.getByRole("button", { name: "New chat" });
		expect(newChat).toHaveTextContent("New Chat");
	});

	it("does not show 'New Chat' text when a real tab is active", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		const newChat = screen.getByRole("button", { name: "New chat" });
		expect(newChat).not.toHaveTextContent("New Chat");
	});

	it("renders a short-handle tab ID badge (shortest unique prefix) per tab", () => {
		const tabs: readonly Tab[] = [
			{ conversationId: "3f9a1b2c-1111", model: "m", title: "Alpha" },
			{ conversationId: "7c2db4e5-2222", model: "m", title: "Beta" },
		];
		render(TabBar, {
			props: {
				tabs,
				activeConversationId: "3f9a1b2c-1111",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		expect(screen.getByText("3f9a")).toBeInTheDocument();
		expect(screen.getByText("7c2d")).toBeInTheDocument();
	});

	it("renders fixed-width tabs", () => {
		render(TabBar, {
			props: {
				tabs: sampleTabs,
				activeConversationId: "c1",
				onSelect: vi.fn(),
				onClose: vi.fn(),
				onNewDraft: vi.fn(),
			},
		});

		for (const t of screen.getAllByRole("tab")) {
			expect(t).toHaveClass("w-48");
		}
	});
});
