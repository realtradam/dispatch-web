import type { WorkspaceEntry } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceResult } from "../adapter/http";
import type { Placement } from "../logic/tile-layout";
import type { WorkspaceStore } from "../store.svelte";
import WorkspaceTile from "./WorkspaceTile.svelte";

function fakeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "my-ws",
    title: "My Workspace",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    archived: false,
    createdAt: 1,
    lastActivityAt: Date.now() - 90_000, // "1m" relative time
    conversationCount: 3,
    ...overrides,
  };
}

function fakeStore(): WorkspaceStore {
  return {
    rename: vi.fn(
      async (id: string, title: string): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, title }),
      }),
    ),
  } as unknown as WorkspaceStore;
}

function fakePlacement(overrides: Partial<Placement> = {}): Placement {
  return { id: "my-ws", col: 1, row: 1, colSpan: 1, rowSpan: 1, ...overrides };
}

describe("WorkspaceTile", () => {
  it("renders the title, slug, conversation count, and relative last-activity", () => {
    render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store: fakeStore(),
        placement: fakePlacement(),
        onRenameEnd: () => {},
      },
    });
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("/my-ws")).toBeInTheDocument();
    // A 1×1 tile is tight: the count compacts to "conv." (wide tiles spell it out).
    expect(screen.getByText(/3 conv\./)).toBeInTheDocument();
    expect(screen.getByText("1m")).toBeInTheDocument();
  });

  it("spells out 'conversations' on a wide tile", () => {
    render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store: fakeStore(),
        placement: fakePlacement({ colSpan: 2, rowSpan: 1 }),
        onRenameEnd: () => {},
      },
    });
    expect(screen.getByText(/3 conversations/)).toBeInTheDocument();
  });

  it("shows the active indicator only when the active port says so", async () => {
    const { container, rerender } = render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store: fakeStore(),
        placement: fakePlacement(),
        active: true,
        onRenameEnd: () => {},
      },
    });
    expect(
      container.querySelector('[aria-label="Workspace has active conversations"]'),
    ).not.toBeNull();

    await rerender({
      ws: fakeEntry(),
      store: fakeStore(),
      placement: fakePlacement(),
      active: false,
      onRenameEnd: () => {},
    });
    expect(container.querySelector('[aria-label="Workspace has active conversations"]')).toBeNull();
  });

  it("double-clicking the title reveals the rename input (semantics preserved)", async () => {
    const user = userEvent.setup();
    const store = fakeStore();
    render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store,
        placement: fakePlacement(),
        onRenameEnd: () => {},
      },
    });

    await user.dblClick(screen.getByText("My Workspace"));
    expect(screen.getByLabelText("Workspace title")).toHaveValue("My Workspace");
  });

  it("the parent-driven rename mode (action bar) opens the same inline editor", async () => {
    const user = userEvent.setup();
    const store = fakeStore();
    render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store,
        placement: fakePlacement(),
        renaming: true,
        onRenameEnd: () => {},
      },
    });
    const input = screen.getByLabelText("Workspace title");
    expect(input).toHaveValue("My Workspace");

    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(store.rename).toHaveBeenCalledWith("my-ws", "Renamed");
  });

  it("a failed rename surfaces the error on the face", async () => {
    const user = userEvent.setup();
    const store = {
      rename: vi.fn(
        async (): Promise<WorkspaceResult<WorkspaceEntry>> => ({
          ok: false,
          error: "boom",
        }),
      ),
    } as unknown as WorkspaceStore;
    render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store,
        placement: fakePlacement(),
        renaming: true,
        onRenameEnd: () => {},
      },
    });

    await user.type(screen.getByLabelText("Workspace title"), "x{Enter}");
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("an unchanged title does not hit the store and still ends the session", async () => {
    const user = userEvent.setup();
    const store = fakeStore();
    const onRenameEnd = vi.fn();
    render(WorkspaceTile, {
      props: {
        ws: fakeEntry(),
        store,
        placement: fakePlacement(),
        renaming: true,
        onRenameEnd,
      },
    });

    await user.type(screen.getByLabelText("Workspace title"), "{Enter}");
    expect(store.rename).not.toHaveBeenCalled();
    expect(onRenameEnd).toHaveBeenCalled();
  });
});
