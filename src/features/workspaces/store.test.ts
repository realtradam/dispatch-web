import type { Workspace, WorkspaceEntry } from "@dispatch/wire";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceResult } from "./adapter/http";
import { archivedCreateMessage, type WorkspaceLookup } from "./logic/create";
import { createWorkspaceStore } from "./store.svelte";

function entry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "a",
    title: "A",
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

/** A fake `WorkspaceHttp` with stubbed star/unstar + a controllable list. */
function fakeHttp(opts: {
  list?: readonly WorkspaceEntry[];
  star?: (id: string) => Promise<WorkspaceResult<Workspace>>;
  unstar?: (id: string) => Promise<WorkspaceResult<Workspace>>;
  archive?: (id: string) => Promise<WorkspaceResult<Workspace>>;
  unarchive?: (id: string) => Promise<WorkspaceResult<Workspace>>;
  get?: (id: string) => Promise<WorkspaceLookup>;
  ensure?: (id: string) => Promise<WorkspaceResult<Workspace>>;
}) {
  return {
    list: vi.fn(
      async (_archived?: "true" | "false" | "all"): Promise<readonly WorkspaceEntry[]> =>
        opts.list ?? [],
    ),
    ensure:
      opts.ensure ??
      vi.fn(
        async (id: string): Promise<WorkspaceResult<Workspace>> => ({
          ok: true,
          value: entry({ id }),
        }),
      ),
    get: vi.fn(opts.get ?? (async (): Promise<WorkspaceLookup> => ({ kind: "missing" }))),
    setTitle: vi.fn(),
    setDefaultCwd: vi.fn(),
    setDefaultComputer: vi.fn(),
    star:
      opts.star ??
      vi.fn(
        async (id: string): Promise<WorkspaceResult<Workspace>> => ({
          ok: true,
          value: entry({ id, starred: true }),
        }),
      ),
    unstar:
      opts.unstar ??
      vi.fn(
        async (id: string): Promise<WorkspaceResult<Workspace>> => ({
          ok: true,
          value: entry({ id, starred: false }),
        }),
      ),
    archive:
      opts.archive ??
      vi.fn(
        async (id: string): Promise<WorkspaceResult<Workspace>> => ({
          ok: true,
          value: entry({ id, archived: true }),
        }),
      ),
    unarchive:
      opts.unarchive ??
      vi.fn(
        async (id: string): Promise<WorkspaceResult<Workspace>> => ({
          ok: true,
          value: entry({ id, archived: false }),
        }),
      ),
    delete: vi.fn(),
  };
}

describe("createWorkspaceStore — setStarred", () => {
  it("optimistically flips starred to true before the request resolves", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", starred: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    let observedDuringCall = false;
    http.star = vi.fn(async (_id: string): Promise<WorkspaceResult<Workspace>> => {
      // While the request is in flight, the store already shows the new state.
      observedDuringCall = store.list[0]?.starred === true;
      return { ok: true, value: entry({ id: "a", starred: true }) };
    });

    await store.setStarred("a", true);

    expect(observedDuringCall).toBe(true);
    expect(http.star).toHaveBeenCalledWith("a");
    expect(store.list[0]?.starred).toBe(true);
  });

  it("calls unstar (DELETE) when starring false", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", starred: true })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    await store.setStarred("a", false);

    expect(http.unstar).toHaveBeenCalledWith("a");
    expect(http.star).not.toHaveBeenCalled();
    expect(store.list[0]?.starred).toBe(false);
  });

  it("reverts the optimistic flip on error", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", starred: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    http.star = vi.fn(
      async (): Promise<WorkspaceResult<Workspace>> => ({ ok: false, error: "boom" }),
    );

    const result = await store.setStarred("a", true);

    expect(result).toEqual({ ok: false, error: "boom" });
    // Reverted to the prior value.
    expect(store.list[0]?.starred).toBe(false);
  });

  it("does not set the store-wide load error on a star failure", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", starred: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    http.star = vi.fn(
      async (): Promise<WorkspaceResult<Workspace>> => ({ ok: false, error: "boom" }),
    );
    await store.setStarred("a", true);

    expect(store.error).toBeNull();
  });

  it("re-sorts so starred workspaces bubble to the top", async () => {
    const http = fakeHttp({
      list: [
        entry({ id: "plain", starred: false, lastActivityAt: 9_000 }),
        entry({ id: "star", starred: false, lastActivityAt: 1_000 }),
      ],
    });
    const store = createWorkspaceStore(http);
    await store.refresh();

    // Before: backend order (most-active first).
    expect(store.list.map((w) => w.id)).toEqual(["plain", "star"]);

    await store.setStarred("star", true);

    // After: starred jumps above the more-recent unstarred workspace.
    expect(store.list.map((w) => w.id)).toEqual(["star", "plain"]);
  });

  it("treats a missing id as not-starred and still calls through (create-on-miss)", async () => {
    const http = fakeHttp({ list: [] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    const result = await store.setStarred("ghost", true);

    expect(result.ok).toBe(true);
    expect(http.star).toHaveBeenCalledWith("ghost");
    // The list is unchanged (the workspace wasn't loaded); a refresh reconciles.
    expect(store.list).toHaveLength(0);
  });
});

describe("createWorkspaceStore — setArchived", () => {
  it("optimistically flips archived to true before the request resolves", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", archived: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    let observedDuringCall = false;
    http.archive = vi.fn(async (_id: string): Promise<WorkspaceResult<Workspace>> => {
      // While the request is in flight, the store already shows the new state.
      observedDuringCall = store.list[0]?.archived === true;
      return { ok: true, value: entry({ id: "a", archived: true }) };
    });

    await store.setArchived("a", true);

    expect(observedDuringCall).toBe(true);
    expect(http.archive).toHaveBeenCalledWith("a");
  });

  it("calls unarchive (DELETE) when archiving false", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", archived: true })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    await store.setArchived("a", false);

    expect(http.unarchive).toHaveBeenCalledWith("a");
    expect(http.archive).not.toHaveBeenCalled();
  });

  it("reverts the optimistic flip on error", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", archived: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    http.archive = vi.fn(
      async (): Promise<WorkspaceResult<Workspace>> => ({ ok: false, error: "boom" }),
    );

    const result = await store.setArchived("a", true);

    expect(result).toEqual({ ok: false, error: "boom" });
    expect(store.list[0]?.archived).toBe(false);
  });

  it("refreshes the active list after a successful archive", async () => {
    const http = fakeHttp({ list: [entry({ id: "a", archived: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();
    const listCallsBefore = http.list.mock.calls.length;

    await store.setArchived("a", true);

    // setArchived triggers a refresh() to reconcile the active-only list.
    expect(http.list.mock.calls.length).toBeGreaterThan(listCallsBefore);
  });
});

describe("createWorkspaceStore — create (archived-slug gate)", () => {
  it("refuses an archived slug with the can't-create message and never calls ensure", async () => {
    const http = fakeHttp({
      get: async () => ({ kind: "found", workspace: entry({ id: "old", archived: true }) }),
    });
    const store = createWorkspaceStore(http);

    const result = await store.create("old");

    expect(result).toEqual({ ok: false, error: archivedCreateMessage("old") });
    expect(http.ensure).not.toHaveBeenCalled();
  });

  it("proceeds for an existing non-archived slug (ensure is called as before)", async () => {
    const http = fakeHttp({
      get: async () => ({ kind: "found", workspace: entry({ id: "taken", archived: false }) }),
    });
    const store = createWorkspaceStore(http);

    const result = await store.create("taken");

    expect(result.ok).toBe(true);
    expect(http.ensure).toHaveBeenCalledTimes(1);
  });

  it("proceeds for a brand-new slug (404 → missing)", async () => {
    const http = fakeHttp({ get: async () => ({ kind: "missing" }) });
    const store = createWorkspaceStore(http);

    const result = await store.create("fresh");

    expect(result.ok).toBe(true);
    expect(http.ensure).toHaveBeenCalledTimes(1);
  });

  it("refuses when the existence check itself failed, without calling ensure (§3.4)", async () => {
    const http = fakeHttp({ get: async () => ({ kind: "failed", error: "db down" }) });
    const store = createWorkspaceStore(http);

    const result = await store.create("maybe");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Couldn't check whether");
    expect(http.ensure).not.toHaveBeenCalled();
  });
});

describe("createWorkspaceStore — refreshArchived", () => {
  it("loads the archived list via list('true') without touching the main list", async () => {
    const http = fakeHttp({ list: [entry({ id: "active", archived: false })] });
    const store = createWorkspaceStore(http);
    await store.refresh();

    // Point the archived call at a different payload.
    http.list = vi.fn(
      async (archived?: "true" | "false" | "all"): Promise<readonly WorkspaceEntry[]> =>
        archived === "true"
          ? [entry({ id: "done", archived: true })]
          : [entry({ id: "active", archived: false })],
    );

    await store.refreshArchived();

    expect(http.list).toHaveBeenCalledWith("true");
    expect(store.archivedList.map((w) => w.id)).toEqual(["done"]);
    // The main (active) list is untouched.
    expect(store.list.map((w) => w.id)).toEqual(["active"]);
  });
});
