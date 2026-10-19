import type { TileGeometryMode, TileLayoutData } from "@dispatch/tile-layout-contract";
import type { Workspace, WorkspaceEntry } from "@dispatch/wire";
import { render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceHttp, WorkspaceResult } from "../adapter/http";
import type { TileLayoutHttp } from "../adapter/tile-layout-http";
import type { WorkspaceLookup } from "../logic/create";
import { createTileLayoutStore } from "../tile-layout-store.svelte";
import WorkspacesHome from "./WorkspacesHome.svelte";

function ws(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "a",
    title: "A",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    archived: false,
    createdAt: 1,
    lastActivityAt: 2,
    conversationCount: 1,
    ...overrides,
  };
}

/** A fake WorkspaceHttp edge with a controllable list (no mocks of our modules). */
function fakeHttp(
  list: WorkspaceEntry[] = [ws()],
  lookup: (id: string) => Promise<WorkspaceLookup> = async () => ({ kind: "missing" }),
): WorkspaceHttp {
  return {
    list: vi.fn(async (): Promise<WorkspaceEntry[]> => list),
    // Create-on-miss: the backend persists the new workspace, so the next
    // `list` serves it too.
    ensure: vi.fn(async (id: string): Promise<WorkspaceResult<Workspace>> => {
      if (!list.some((w) => w.id === id)) list.push(ws({ id, title: id }));
      return { ok: true, value: ws({ id, title: id }) };
    }),
    get: vi.fn(lookup),
    setTitle: vi.fn(),
    setDefaultCwd: vi.fn(),
    setDefaultComputer: vi.fn(),
    star: vi.fn(),
    unstar: vi.fn(),
    delete: vi.fn(async (): Promise<WorkspaceResult<{ closedCount: number }>> => {
      // Mirrors the backend: the workspace leaves the list.
      list.splice(0);
      return { ok: true, value: { closedCount: 0 } };
    }),
  } as unknown as WorkspaceHttp;
}

/**
 * A fake tile-layout HTTP edge serving ONE controllable document per mode
 * (no mocks of our modules). `docs` is the live store — assertions read it
 * after `waitFor` (the boot probe + debounced sync writes land there).
 */
function memoryLayout(
  initial: TileLayoutData | null = null,
): TileLayoutHttp & { docs: Map<TileGeometryMode, TileLayoutData> } {
  const docs = new Map<TileGeometryMode, TileLayoutData>();
  if (initial !== null) docs.set("wide", initial);
  return {
    docs,
    async getLayout(mode) {
      return { ok: true, layout: docs.get(mode) ?? { version: 2, tiles: [] } };
    },
    async putLayout(mode, layout) {
      docs.set(mode, layout);
      return { ok: true, layout };
    },
    async deleteLayout(mode) {
      docs.set(mode, { version: 2, tiles: [] });
      return { ok: true, layout: docs.get(mode) as TileLayoutData };
    },
  };
}

describe("WorkspacesHome (tile canvas)", () => {
  it("renders one tile per workspace, in the persisted tile order (not the list order)", async () => {
    const list = [ws({ id: "a", title: "A" }), ws({ id: "b", title: "B" })];
    const layout = memoryLayout({
      version: 2,
      tiles: [
        { id: "b", order: 0, colSpan: 1, rowSpan: 1 },
        { id: "a", order: 1, colSpan: 1, rowSpan: 1 },
      ],
    });
    render(WorkspacesHome, {
      props: {
        store: (await import("../store.svelte")).createWorkspaceStore(fakeHttp(list)),
        onNavigate: vi.fn(),
        computers: [],
        tiles: createTileLayoutStore({ http: layout }),
      },
    });

    await screen.findByRole("button", { name: "Open workspace B" });
    const wrappers = document.querySelectorAll("[data-tile-id]");
    expect([...wrappers].map((el) => el.getAttribute("data-tile-id"))).toEqual(["b", "a"]);
  });

  it("clicking a tile navigates to the workspace path", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(WorkspacesHome, {
      props: {
        store: (await import("../store.svelte")).createWorkspaceStore(fakeHttp()),
        onNavigate,
        computers: [],
        tiles: createTileLayoutStore({ http: memoryLayout() }),
      },
    });

    const tile = await screen.findByRole("button", { name: "Open workspace A" });
    await user.click(tile);
    expect(onNavigate).toHaveBeenCalledWith("/a");
  });

  it("creating a workspace from the header does NOT navigate; the new tile enters rename mode", async () => {
    const user = userEvent.setup();
    const list = [ws({ id: "a", title: "A" })];
    const onNavigate = vi.fn();
    const store = (await import("../store.svelte")).createWorkspaceStore(fakeHttp(list));
    render(WorkspacesHome, {
      props: {
        store,
        onNavigate,
        computers: [],
        tiles: createTileLayoutStore({ http: memoryLayout() }),
      },
    });

    await screen.findByRole("button", { name: "Open workspace A" });
    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByRole("textbox", { name: "New workspace" }), "fresh-ws{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText("Workspace title", { selector: "input" })).toBeInTheDocument();
    });
    expect(onNavigate).not.toHaveBeenCalled();
    // The backend was asked to create it (create-on-miss).
    expect(store.list.map((w) => w.id)).toContain("fresh-ws");
  });

  it("refuses to create an archived slug: message in the popover, form stays open, no tile", async () => {
    const user = userEvent.setup();
    const list = [ws({ id: "a", title: "A" })];
    const http = fakeHttp(list, async (id) => ({
      kind: "found",
      workspace: ws({ id, title: id, archived: true }),
    }));
    const store = (await import("../store.svelte")).createWorkspaceStore(http);
    render(WorkspacesHome, {
      props: {
        store,
        onNavigate: vi.fn(),
        computers: [],
        tiles: createTileLayoutStore({ http: memoryLayout() }),
      },
    });

    await screen.findByRole("button", { name: "Open workspace A" });
    await user.click(screen.getByRole("button", { name: "New workspace" }));
    await user.type(screen.getByRole("textbox", { name: "New workspace" }), "old-ws{Enter}");

    expect(await screen.findByText(/already exists and is archived/)).toBeInTheDocument();
    // The popover stays open (the form/input is still mounted).
    expect(screen.getByRole("textbox", { name: "New workspace" })).toBeInTheDocument();
    // Nothing was ensured, no tile appeared, and no rename mode was entered.
    expect(http.ensure).not.toHaveBeenCalled();
    expect(store.list.map((w) => w.id)).toEqual(["a"]);
    expect(screen.queryByLabelText("Workspace title")).toBeNull();
  });

  it("right-clicking a tile opens the action bar; Delete keeps the confirm + store call", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const list = [ws({ id: "a", title: "A" })];
    const store = (await import("../store.svelte")).createWorkspaceStore(fakeHttp(list));
    render(WorkspacesHome, {
      props: {
        store,
        onNavigate: vi.fn(),
        computers: [],
        tiles: createTileLayoutStore({ http: memoryLayout() }),
      },
    });

    const tile = await screen.findByRole("button", { name: "Open workspace A" });
    await user.pointer({ keys: "[MouseRight]", target: tile });

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    await user.click(deleteButton);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Delete workspace "A"?'));
    await waitFor(() => {
      expect(store.list.length).toBe(0);
    });
    confirmSpy.mockRestore();
  });

  it("workspaces unknown to the layout append at the end (deep-link auto-create)", async () => {
    const list = [ws({ id: "a", title: "A" }), ws({ id: "b", title: "B" })];
    const layout = memoryLayout({
      version: 2,
      tiles: [{ id: "b", order: 0, colSpan: 1, rowSpan: 1 }],
    });
    render(WorkspacesHome, {
      props: {
        store: (await import("../store.svelte")).createWorkspaceStore(fakeHttp(list)),
        onNavigate: vi.fn(),
        computers: [],
        tiles: createTileLayoutStore({ http: layout }),
      },
    });

    await screen.findByRole("button", { name: "Open workspace B" });
    await screen.findByRole("button", { name: "Open workspace A" });
    const wrappers = document.querySelectorAll("[data-tile-id]");
    expect([...wrappers].map((el) => el.getAttribute("data-tile-id"))).toEqual(["b", "a"]);
    // And the sync persisted the appended entry.
    await waitFor(() => {
      const tiles = layout.docs.get("wide")?.tiles ?? [];
      expect(tiles.map((tile) => tile.id)).toEqual(["b", "a"]);
    });
  });
});
