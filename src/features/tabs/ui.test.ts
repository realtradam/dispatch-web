import { fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Tab } from "./tabs";
import TabList from "./ui/TabList.svelte";

const sampleTabs: readonly Tab[] = [
  { conversationId: "c1", model: "openai/gpt-4", title: "First", workspaceId: "default" },
  { conversationId: "c2", model: "anthropic/claude-3", title: "Second", workspaceId: "default" },
  { conversationId: "c3", model: "google/gemini", title: "Third", workspaceId: "default" },
];

describe("TabList", () => {
  it("renders one role=tab element per tab showing each title", () => {
    render(TabList, {
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

  it("marks the active tab as aria-selected", () => {
    render(TabList, {
      props: {
        tabs: sampleTabs,
        activeConversationId: "c2",
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
      },
    });

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with the conversationId when a tab is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(TabList, {
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

    render(TabList, {
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

    render(TabList, {
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

  it("shows visible 'New Chat' text when activeConversationId is null", () => {
    render(TabList, {
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
    render(TabList, {
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
      { conversationId: "3f9a1b2c-1111", model: "m", title: "Alpha", workspaceId: "default" },
      { conversationId: "7c2db4e5-2222", model: "m", title: "Beta", workspaceId: "default" },
    ];
    render(TabList, {
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

  it("renders each tab as a single vertical row (flex-col list, not a horizontal strip)", () => {
    render(TabList, {
      props: {
        tabs: sampleTabs,
        activeConversationId: "c1",
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
      },
    });

    // The scroll region containing the tab rows is a vertical flex column.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(0);
    const region = tabs[0]?.parentElement;
    expect(region).toHaveClass("flex-col");
  });

  it("fixes the tab list region at 60vh so a long set scrolls internally", () => {
    render(TabList, {
      props: {
        tabs: sampleTabs,
        activeConversationId: "c1",
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
      },
    });

    const tabs = screen.getAllByRole("tab");
    const region = tabs[0]?.parentElement;
    expect(region).toHaveClass("h-[60vh]");
    expect(region).toHaveClass("overflow-y-auto");
  });

  it("calls onRename when a tab title is double-clicked and committed with Enter", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();

    render(TabList, {
      props: {
        tabs: sampleTabs,
        activeConversationId: "c1",
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
        onRename,
      },
    });

    const titleButtons = screen.getAllByRole("button");
    // The inline-rename trigger is the title span (role=button) — find the one
    // whose text matches the first tab's title.
    const titleButton = titleButtons.find((b) => b.textContent === "First");
    if (!titleButton) throw new Error("title button not found");
    await user.dblClick(titleButton);

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("c1", "Renamed");
  });

  it("copies the conversation id to the clipboard and highlights the badge text when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const onSelect = vi.fn();

    render(TabList, {
      props: {
        tabs: sampleTabs,
        activeConversationId: "c1",
        onSelect,
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
      },
    });

    const idBadge = screen.getByRole("button", { name: "Copy conversation id c1" });
    await fireEvent.click(idBadge);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("c1");
    // The badge text is NOT swapped (no width shift) — the highlight (selection)
    // is the only indicator.
    expect(idBadge).toHaveTextContent("c1");
    expect(idBadge).not.toHaveTextContent("Copied");
    // The badge text is selected (highlighted) as the copy indicator.
    const selection = window.getSelection();
    expect(selection?.toString()).toBe("c1");
    // Clicking the ID must NOT switch tabs (the badge stops propagation).
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a loading RING for a 'queued' tab and loading DOTS for an 'active' tab", () => {
    render(TabList, {
      props: {
        tabs: sampleTabs,
        activeConversationId: "c1",
        statusFor: (id: string) => (id === "c1" ? "queued" : id === "c2" ? "active" : undefined),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
      },
    });

    // c1 is queued → a ring (DaisyUI `loading-ring`), labeled "Queued".
    const queuedRing = screen.getByLabelText("Queued");
    expect(queuedRing.className).toContain("loading-ring");
    expect(queuedRing.closest('[role="tab"]')).toHaveTextContent("First");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    const activeTab = tabs[1];
    const idleTab = tabs[2];
    if (activeTab === undefined || idleTab === undefined) throw new Error("missing tabs");

    // c2 is active → loading dots (NOT a ring).
    expect(activeTab.querySelector(".loading-dots")).not.toBeNull();
    expect(activeTab.querySelector(".loading-ring")).toBeNull();

    // c3 has no status → no spinner at all.
    expect(idleTab.querySelector(".loading")).toBeNull();
  });
});
