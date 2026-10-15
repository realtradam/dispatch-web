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

  it("renders the tabs as a 2-column grid of same-size cards", () => {
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
    const grid = tabs[0]?.parentElement;
    expect(grid).toHaveClass("grid", "grid-cols-2");
    // Every card has the same fixed height; none is double-width without a group.
    for (const t of tabs) {
      expect(t).toHaveClass("h-[4.5rem]");
      expect(t).not.toHaveClass("col-span-2");
    }
  });

  it("fixes the tab grid region at 40vh so a long set scrolls internally", () => {
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
    const region = tabs[0]?.parentElement?.parentElement;
    expect(region).toHaveClass("h-[40vh]");
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

  describe("subagent groups", () => {
    const grouped: readonly Tab[] = [
      { conversationId: "p", model: "m", title: "Parent", workspaceId: "w" },
      {
        conversationId: "c1",
        model: "m",
        title: "Child 1",
        workspaceId: "w",
        tabGroupParentId: "p",
      },
      {
        conversationId: "c2",
        model: "m",
        title: "Child 2",
        workspaceId: "w",
        tabGroupParentId: "p",
      },
      {
        conversationId: "g",
        model: "m",
        title: "Grandchild",
        workspaceId: "w",
        tabGroupParentId: "c1",
      },
      { conversationId: "solo", model: "m", title: "Solo", workspaceId: "w" },
    ];

    function renderGrouped(onSetTabGroup = vi.fn()) {
      render(TabList, {
        props: {
          tabs: grouped,
          activeConversationId: "p",
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onNewDraft: vi.fn(),
          onSetTabGroup,
        },
      });
      return onSetTabGroup;
    }

    const card = (id: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(`[role="tab"][data-conversation-id="${id}"]`);
      if (el === null) throw new Error(`card ${id} not found`);
      return el;
    };

    it("renders a group parent double-width inside a darker group box with its subagents", () => {
      renderGrouped();
      const box = document.querySelector<HTMLElement>('[data-tab-group="p"]');
      expect(box).not.toBeNull();
      expect(box).toHaveClass("col-span-2");
      expect(card("p")).toHaveClass("col-span-2");
      expect(card("p")).toHaveTextContent("2 subagents");
      expect(box?.contains(card("c1"))).toBe(true);
      expect(box?.contains(card("c2"))).toBe(true);
      expect(box?.contains(card("solo"))).toBe(false);
      // Subagents are regular half-width cards.
      expect(card("c2")).not.toHaveClass("col-span-2");
    });

    it("nests a subagent that has its own subagents in an inner box", () => {
      renderGrouped();
      const outer = document.querySelector<HTMLElement>('[data-tab-group="p"]');
      const inner = document.querySelector<HTMLElement>('[data-tab-group="c1"]');
      expect(inner).not.toBeNull();
      expect(outer?.contains(inner)).toBe(true);
      expect(inner?.dataset.level).toBe("2");
      expect(card("c1")).toHaveClass("col-span-2");
      expect(inner?.contains(card("g"))).toBe(true);
      // Inner boxes bleed less than outer ones, so nested edges stay visible
      // while the cards keep identical widths.
      const bleed = (el: HTMLElement | null) => Number.parseFloat(el?.style.paddingLeft ?? "");
      expect(bleed(inner)).toBeGreaterThan(0);
      expect(bleed(outer)).toBeGreaterThan(bleed(inner));
      // Equal internal padding on all four sides (an even-looking box).
      for (const box of [outer, inner]) {
        const s = box?.style;
        expect([s?.paddingTop, s?.paddingRight, s?.paddingBottom]).toEqual([
          s?.paddingLeft,
          s?.paddingLeft,
          s?.paddingLeft,
        ]);
      }
      // Every box paints a 20% lavender tint, so nested boxes compound per level.
      expect(outer).toHaveClass("bg-secondary/20");
      expect(inner).toHaveClass("bg-secondary/20");
      expect(outer?.style.getPropertyValue("margin-inline")).toBe(`-${outer?.style.paddingLeft}`);
    });

    it("returns the group parent to a half-width card once all its subagent tabs close", async () => {
      const props = {
        tabs: grouped,
        activeConversationId: "p",
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
        onSetTabGroup: vi.fn(),
      };
      const { rerender } = render(TabList, { props });
      expect(card("p")).toHaveClass("col-span-2");

      // Close one subagent: still a group (1 left).
      await rerender({ ...props, tabs: grouped.filter((t) => t.conversationId !== "c2") });
      expect(card("p")).toHaveClass("col-span-2");
      expect(card("p")).toHaveTextContent("1 subagent");

      // Close the rest (c1 + its own subagent g): back to a plain half-width card.
      await rerender({
        ...props,
        tabs: grouped.filter((t) => ["p", "solo"].includes(t.conversationId)),
      });
      expect(card("p")).not.toHaveClass("col-span-2");
      expect(card("p")).not.toHaveTextContent("subagent");
      expect(document.querySelector("[data-tab-group]")).toBeNull();
    });

    it("keeps the parent wide while a nested descendant's own parent remains open", async () => {
      const props = {
        tabs: grouped,
        activeConversationId: "p",
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onNewDraft: vi.fn(),
      };
      const { rerender } = render(TabList, { props });
      // Close the grandchild only: c1 goes back to half width, p stays a group.
      await rerender({ ...props, tabs: grouped.filter((t) => t.conversationId !== "g") });
      expect(card("c1")).not.toHaveClass("col-span-2");
      expect(document.querySelector('[data-tab-group="c1"]')).toBeNull();
      expect(card("p")).toHaveClass("col-span-2");
    });

    it("trims the bottom padding under a nested box on the last row to match its side gaps", () => {
      // p's children: c2 (card) then c1 (nested group) → c1's box is the last row.
      const lastIsGroup: readonly Tab[] = [
        { conversationId: "p", model: "m", title: "Parent", workspaceId: "w" },
        { conversationId: "c2", model: "m", title: "C2", workspaceId: "w", tabGroupParentId: "p" },
        { conversationId: "c1", model: "m", title: "C1", workspaceId: "w", tabGroupParentId: "p" },
        { conversationId: "g", model: "m", title: "G", workspaceId: "w", tabGroupParentId: "c1" },
      ];
      render(TabList, {
        props: {
          tabs: lastIsGroup,
          activeConversationId: "p",
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onNewDraft: vi.fn(),
        },
      });
      const outer = document.querySelector<HTMLElement>('[data-tab-group="p"]');
      const inner = document.querySelector<HTMLElement>('[data-tab-group="c1"]');
      const px = (v: string | undefined) => Number.parseFloat(v ?? "");
      const outerSide = px(outer?.style.paddingLeft);
      const innerBleed = px(inner?.style.paddingLeft);
      // Side gap between the two box edges = outer bleed − inner bleed; the
      // bottom gap must equal it.
      expect(px(outer?.style.paddingBottom)).toBe(outerSide - innerBleed);
      expect(px(outer?.style.paddingTop)).toBe(outerSide);
      // The inner box ends in a card → untouched, even on all sides.
      expect(px(inner?.style.paddingBottom)).toBe(innerBleed);
    });

    it("right-click opens the menu; 'Remove from group' ungroups the tab", async () => {
      const onSetTabGroup = renderGrouped();
      await fireEvent.contextMenu(card("c2"), { clientX: 10, clientY: 10 });
      const menu = screen.getByRole("menu");
      expect(menu).toBeInTheDocument();
      await fireEvent.click(screen.getByRole("menuitem", { name: /Remove from group/ }));
      expect(onSetTabGroup).toHaveBeenCalledWith("c2", null);
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("'Add to group' lists valid parents (no self/descendants/current) and moves the tab", async () => {
      const onSetTabGroup = renderGrouped();
      await fireEvent.contextMenu(card("c1"));
      const candidates = [...document.querySelectorAll<HTMLElement>("[data-group-candidate]")].map(
        (el) => el.dataset.groupCandidate,
      );
      expect(candidates).toEqual(["c2", "solo"]);
      const solo = document.querySelector<HTMLElement>('[data-group-candidate="solo"]');
      if (solo === null) throw new Error("solo candidate missing");
      await fireEvent.click(solo);
      expect(onSetTabGroup).toHaveBeenCalledWith("c1", "solo");
    });

    it("a group parent's menu can ungroup all of its direct subagents", async () => {
      const onSetTabGroup = renderGrouped();
      await fireEvent.contextMenu(card("p"));
      expect(screen.queryByRole("menuitem", { name: /Remove from group/ })).toBeNull();
      await fireEvent.click(screen.getByRole("menuitem", { name: /Ungroup 2 subagents/ }));
      expect(onSetTabGroup).toHaveBeenCalledTimes(2);
      expect(onSetTabGroup).toHaveBeenCalledWith("c1", null);
      expect(onSetTabGroup).toHaveBeenCalledWith("c2", null);
    });

    it("Escape closes the menu without changing anything", async () => {
      const onSetTabGroup = renderGrouped();
      await fireEvent.contextMenu(card("solo"));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      await fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(onSetTabGroup).not.toHaveBeenCalled();
    });

    it("touch-and-hold opens the menu and swallows the follow-up click", async () => {
      vi.useFakeTimers();
      try {
        const onSelect = vi.fn();
        render(TabList, {
          props: {
            tabs: grouped,
            activeConversationId: "p",
            onSelect,
            onClose: vi.fn(),
            onNewDraft: vi.fn(),
            onSetTabGroup: vi.fn(),
          },
        });
        await fireEvent.pointerDown(card("solo"), { pointerType: "touch", clientX: 5, clientY: 5 });
        await vi.advanceTimersByTimeAsync(600);
        expect(screen.getByRole("menu")).toBeInTheDocument();
        await fireEvent.click(card("solo"));
        expect(onSelect).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("a touch that moves away cancels the long-press", async () => {
      vi.useFakeTimers();
      try {
        renderGrouped();
        await fireEvent.pointerDown(card("solo"), { pointerType: "touch", clientX: 5, clientY: 5 });
        await fireEvent.pointerMove(card("solo"), {
          pointerType: "touch",
          clientX: 5,
          clientY: 60,
        });
        await vi.advanceTimersByTimeAsync(600);
        expect(screen.queryByRole("menu")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
