import type { WorkspaceEntry } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TileActionBar from "./TileActionBar.svelte";

function ws(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "my-ws",
    title: "My Workspace",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    archived: false,
    createdAt: 1,
    lastActivityAt: 2,
    conversationCount: 0,
    ...overrides,
  };
}

function handlers() {
  return {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onResize: vi.fn(),
    onToggleStar: vi.fn(),
    onDetails: vi.fn(),
    onPlugins: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TileActionBar", () => {
  it("renders the Open · Rename · Resize · Star · Details · Delete actions", () => {
    const h = handlers();
    render(TileActionBar, { props: { ws: ws(), ...h } });
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Star" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close actions" })).toBeInTheDocument();
  });

  it("omits Plugins when no plugins port is present, renders it when one is", () => {
    const h = handlers();
    const without = render(TileActionBar, { props: { ws: ws(), ...h } });
    expect(without.queryByRole("button", { name: "Plugins" })).toBeNull();
    without.unmount();

    render(TileActionBar, { props: { ws: ws(), withPlugins: true, ...h } });
    expect(screen.getByRole("button", { name: "Plugins" })).toBeInTheDocument();
  });

  it("labels the star action by the current state (Star ↔ Unstar)", () => {
    const h = handlers();
    const unstarred = render(TileActionBar, { props: { ws: ws({ starred: false }), ...h } });
    expect(screen.getByRole("button", { name: "Star" })).toBeInTheDocument();
    unstarred.unmount();

    render(TileActionBar, { props: { ws: ws({ starred: true }), ...h } });
    expect(screen.getByRole("button", { name: "Unstar" })).toBeInTheDocument();
  });

  it("dispatches each action", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(TileActionBar, { props: { ws: ws(), ...h } });

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Resize" }));
    await user.click(screen.getByRole("button", { name: "Star" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Close actions" }));

    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onRename).toHaveBeenCalledTimes(1);
    expect(h.onResize).toHaveBeenCalledTimes(1);
    expect(h.onToggleStar).toHaveBeenCalledTimes(1);
    expect(h.onDetails).toHaveBeenCalledTimes(1);
    expect(h.onArchive).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});
