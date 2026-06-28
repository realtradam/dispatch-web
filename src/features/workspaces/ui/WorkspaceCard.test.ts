import type { WorkspaceEntry } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceResult } from "../adapter/http";
import type { WorkspaceStore } from "../store.svelte";
import WorkspaceCard from "./WorkspaceCard.svelte";

function fakeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "my-ws",
    title: "My Workspace",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    createdAt: 1,
    lastActivityAt: 2,
    conversationCount: 3,
    ...overrides,
  };
}

/** A fake store that records calls + resolves ok. */
function fakeStore() {
  return {
    rename: vi.fn(
      async (id: string, _title: string): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, title: _title }),
      }),
    ),
    setDefaultCwd: vi.fn(
      async (id: string, defaultCwd: string | null): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, defaultCwd }),
      }),
    ),
    setDefaultComputer: vi.fn(
      async (id: string, computerId: string | null): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, defaultComputerId: computerId }),
      }),
    ),
    setStarred: vi.fn(
      async (id: string, starred: boolean): Promise<WorkspaceResult<WorkspaceEntry>> => ({
        ok: true,
        value: fakeEntry({ id, starred }),
      }),
    ),
    remove: vi.fn(
      async (): Promise<WorkspaceResult<{ closedCount: number }>> => ({
        ok: true,
        value: { closedCount: 0 },
      }),
    ),
  };
}

describe("WorkspaceCard", () => {
  it("renders the title, slug, and an Open link", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry(), store, onNavigate: vi.fn(), computers: [] },
    });
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("/my-ws")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/my-ws");
  });

  it("double-clicking the title reveals an edit input", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry(), store, onNavigate: vi.fn(), computers: [] },
    });

    await user.dblClick(screen.getByText("My Workspace"));
    expect(screen.getByLabelText("Workspace title")).toHaveValue("My Workspace");
  });

  it("renames via the store on Enter", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry(), store, onNavigate: vi.fn(), computers: [] },
    });

    await user.dblClick(screen.getByText("My Workspace"));
    const input = screen.getByLabelText("Workspace title");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    expect(store.rename).toHaveBeenCalledWith("my-ws", "Renamed");
  });

  it("enables Set only when the cwd differs, then saves it", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ defaultCwd: "/old" }), store, onNavigate: vi.fn(), computers: [] },
    });

    const input = screen.getByLabelText("Default working directory");
    expect(input).toHaveValue("/old");
    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();

    await user.clear(input);
    await user.type(input, "/new/path");
    expect(screen.getByRole("button", { name: "Set" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(store.setDefaultCwd).toHaveBeenCalledWith("my-ws", "/new/path");
  });

  it("clears the cwd to null when saved empty (inherits the server default)", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ defaultCwd: "/old" }), store, onNavigate: vi.fn(), computers: [] },
    });

    const input = screen.getByLabelText("Default working directory");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Set" }));

    expect(store.setDefaultCwd).toHaveBeenCalledWith("my-ws", null);
  });

  it("the Open link navigates to the workspace in the same tab (SPA navigation, no new tab)", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    const onNavigate = vi.fn();
    render(WorkspaceCard, { props: { ws: fakeEntry(), store, onNavigate, computers: [] } });

    const open = screen.getByRole("link", { name: "Open" });
    // Still a real link (progressive enhancement): href points at the workspace.
    expect(open).toHaveAttribute("href", "/my-ws");
    // But it no longer opens a new browser tab.
    expect(open).not.toHaveAttribute("target", "_blank");
    // Clicking navigates in-place via the SPA callback.
    await user.click(open);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("/my-ws");
  });

  // ── Active indicator (loading dots) ──────────────────────────────────────

  it("shows no loading-dots when no hasActive port is given", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    const { container } = render(WorkspaceCard, {
      props: { ws: fakeEntry(), store, onNavigate: vi.fn(), computers: [] },
    });
    expect(container.querySelector(".loading-dots")).toBeNull();
  });

  it("shows no loading-dots when hasActive returns false", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    const { container } = render(WorkspaceCard, {
      props: {
        ws: fakeEntry(),
        store,
        onNavigate: vi.fn(),
        computers: [],
        hasActive: () => false,
      },
    });
    expect(container.querySelector(".loading-dots")).toBeNull();
  });

  it("shows loading-dots when hasActive returns true", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    const { container } = render(WorkspaceCard, {
      props: {
        ws: fakeEntry(),
        store,
        onNavigate: vi.fn(),
        computers: [],
        hasActive: () => true,
      },
    });
    const dots = container.querySelector(".loading-dots");
    expect(dots).not.toBeNull();
    // Accessible label ties the indicator to the workspace-active concept.
    expect(dots?.getAttribute("aria-label")).toBe("Workspace has active conversations");
  });

  it("forwards the workspace id to hasActive", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    const seen: string[] = [];
    render(WorkspaceCard, {
      props: {
        ws: fakeEntry({ id: "proj-x" }),
        store,
        onNavigate: vi.fn(),
        computers: [],
        hasActive: (id: string) => {
          seen.push(id);
          return false;
        },
      },
    });
    expect(seen).toEqual(["proj-x"]);
  it("renders an outline star button for an unstarred workspace", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: false }), store, onNavigate: vi.fn(), computers: [] },
    });
    const star = screen.getByRole("button", { name: "Star workspace" });
    expect(star).toHaveAttribute("aria-pressed", "false");
  });

  it("renders a filled star button for a starred workspace", () => {
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: true }), store, onNavigate: vi.fn(), computers: [] },
    });
    const star = screen.getByRole("button", { name: "Unstar workspace" });
    expect(star).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles the star via the store on click", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: false }), store, onNavigate: vi.fn(), computers: [] },
    });

    await user.click(screen.getByRole("button", { name: "Star workspace" }));
    expect(store.setStarred).toHaveBeenCalledWith("my-ws", true);
  });

  it("clicking a starred workspace's star calls setStarred(id, false)", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: true }), store, onNavigate: vi.fn(), computers: [] },
    });

    await user.click(screen.getByRole("button", { name: "Unstar workspace" }));
    expect(store.setStarred).toHaveBeenCalledWith("my-ws", false);
  });

  it("renders no star error on a successful toggle", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: false }), store, onNavigate: vi.fn(), computers: [] },
    });

    await user.click(screen.getByRole("button", { name: "Star workspace" }));
    expect(screen.queryByText(/Star toggle failed/i)).not.toBeInTheDocument();
  });

  it("shows an inline error when setStarred fails (result.ok false)", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    // The store reverts the optimistic flip on failure, so the entry's
    // `starred` stays false — fake the revert by returning ok:false unchanged.
    store.setStarred = vi.fn(
      async (): Promise<WorkspaceResult<WorkspaceEntry>> => ({ ok: false, error: "boom" }),
    );
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: false }), store, onNavigate: vi.fn(), computers: [] },
    });

    await user.click(screen.getByRole("button", { name: "Star workspace" }));

    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("re-enables the star button after a failure (savingStar resets)", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    store.setStarred = vi.fn(
      async (): Promise<WorkspaceResult<WorkspaceEntry>> => ({ ok: false, error: "boom" }),
    );
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: false }), store, onNavigate: vi.fn(), computers: [] },
    });

    const star = screen.getByRole("button", { name: "Star workspace" });
    await user.click(star);
    // After the failed toggle, the button is NOT disabled (savingStar reset).
    expect(star).not.toBeDisabled();
  });

  it("re-enables the star button even when setStarred throws", async () => {
    const user = userEvent.setup();
    const store = fakeStore() as unknown as WorkspaceStore;
    store.setStarred = vi.fn(async (): Promise<WorkspaceResult<WorkspaceEntry>> => {
      throw new Error("network");
    });
    render(WorkspaceCard, {
      props: { ws: fakeEntry({ starred: false }), store, onNavigate: vi.fn(), computers: [] },
    });

    const star = screen.getByRole("button", { name: "Star workspace" });
    await user.click(star);
    // savingStar must reset via try/finally even on a throw.
    expect(star).not.toBeDisabled();
    expect(screen.getByText("network")).toBeInTheDocument();
  });
});
