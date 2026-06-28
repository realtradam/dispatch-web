import type { Workspace, WorkspaceEntry } from "@dispatch/wire";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceResult } from "./adapter/http";
import { createWorkspaceStore } from "./store.svelte";

function entry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "a",
    title: "A",
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
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
}) {
  return {
    list: vi.fn(async (): Promise<readonly WorkspaceEntry[]> => opts.list ?? []),
    ensure: vi.fn(),
    get: vi.fn(),
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
