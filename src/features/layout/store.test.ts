import {
  type ApplyOpsResult,
  DEFAULT_LAYOUT,
  type LayoutOp,
  type LayoutTree,
} from "@dispatch/layout-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutHttp, LayoutHttpResult } from "./adapter/http";
import { overlaySidePanels } from "./logic/seed";
import { createLayoutStore } from "./store.svelte";

/**
 * Layout store tests (plan 02 verification gate) — mock HTTP EDGES ONLY (the
 * injected `LayoutHttp` is the store's outermost boundary; nothing internal
 * is mocked — asymmetric testing per AGENTS.md). Fake timers drive the edit
 * PUT debounce deterministically.
 */

/** A recording fake of the LayoutHttp edge, scripted per test. */
interface HttpFake extends LayoutHttp {
  getCalls: string[];
  putCalls: Array<{ workspaceId: string; tree: LayoutTree }>;
  deleteCalls: string[];
  getResult: (workspaceId: string) => LayoutHttpResult;
  putResult: (workspaceId: string, tree: LayoutTree) => LayoutHttpResult;
  deleteResult: (workspaceId: string) => LayoutHttpResult;
  opsResult: (workspaceId: string, ops: readonly LayoutOp[]) => ApplyOpsResult;
}

function fakeHttp(
  getResult: (workspaceId: string) => LayoutHttpResult = () => ({
    ok: false,
    notFound: true,
    error: "No layout provider is active",
  }),
  putResult: (workspaceId: string, tree: LayoutTree) => LayoutHttpResult = (_ws, tree) => ({
    ok: true,
    tree,
  }),
): HttpFake {
  const getCalls: string[] = [];
  const putCalls: Array<{ workspaceId: string; tree: LayoutTree }> = [];
  const deleteCalls: string[] = [];
  const fake: HttpFake = {
    getCalls,
    putCalls,
    deleteCalls,
    getResult,
    putResult,
    // Re-scriptable outcome (default: the fresh seed a reset returns).
    deleteResult: () => ({ ok: true, tree: DEFAULT_LAYOUT }),
    // Re-scriptable outcome (default: the typed no-provider failure the ABI
    // documents; tests re-assign mid-test like putResult).
    opsResult: () => ({ ok: false, error: "no layout provider active" }),
    // Delegate to the CURRENT properties so a test can re-script outcomes
    // mid-test (http.putResult = …).
    async getTree(workspaceId) {
      getCalls.push(workspaceId);
      return fake.getResult(workspaceId);
    },
    async putTree(workspaceId, tree) {
      putCalls.push({ workspaceId, tree });
      return fake.putResult(workspaceId, tree);
    },
    async deleteTree(workspaceId) {
      deleteCalls.push(workspaceId);
      return fake.deleteResult(workspaceId);
    },
    async postOps(workspaceId, ops) {
      return fake.opsResult(workspaceId, ops);
    },
  };
  return fake;
}

function storageWith(views: string[] | null): Storage {
  const map = new Map<string, string>();
  if (views !== null) map.set("test.sidebar.views", JSON.stringify(views));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem: (k) => map.get(k) ?? null,
    key: () => null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => map.set(k, v),
  };
}

const KNOWN = ["tabs", "model", "extensions", "vision"];

function makeStore(http: HttpFake, extra: Record<string, unknown> = {}) {
  return createLayoutStore({
    http,
    workspaceId: "ws-a",
    knownViews: KNOWN,
    sidebarViewsKey: "test.sidebar.views",
    debounceMs: 100,
    warn: (message) => warnings.push(message),
    ...extra,
  });
}

let warnings: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  warnings = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("layout store — no-provider fallback (§2.6)", () => {
  it("a 404 probe keeps the default tree, marks the provider absent, and logs ONCE", async () => {
    const http = fakeHttp();
    const store = makeStore(http);

    await store.probe("ws-a", { boot: true });
    expect(store.providerState).toBe("absent");
    expect(store.tree).toEqual(DEFAULT_LAYOUT);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no layout provider");

    // A re-probe (extensions-changed while still absent) does not re-warn.
    await store.probe("ws-a");
    expect(warnings).toHaveLength(1);
  });

  it("a network failure degrades like a 404 (quiet, no error UI)", async () => {
    const http = fakeHttp(() => ({ ok: false, notFound: true, error: "fetch blew up" }));
    const store = makeStore(http);
    await store.probe("ws-a");
    expect(store.providerState).toBe("absent");
    expect(store.tree).toEqual(DEFAULT_LAYOUT);
  });

  it("edits still apply in no-provider mode but are EPHEMERAL (no PUT, no rollback, no warning)", async () => {
    const http = fakeHttp();
    const store = makeStore(http);
    await store.probe("ws-a"); // absent now
    expect(store.providerState).toBe("absent");

    const edited = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    store.onTreeChange(edited);
    expect(store.tree).toEqual(edited);

    vi.advanceTimersByTime(500);
    expect(http.putCalls).toEqual([]); // ephemeral: no write attempted
    // Quiet = the single absence log (from the probe), nothing more.
    expect(warnings).toHaveLength(1);
  });

  it("an edit while the probe is still in flight is PUT optimistically; a 404 flips absent and KEEPS the edit", async () => {
    const http = fakeHttp();
    // The PUT is a 404 (the probe will confirm: no provider).
    http.putResult = () => ({ ok: false, notFound: true, error: "No layout provider is active" });
    const store = makeStore(http);

    void store.probe("ws-a"); // in flight (microtask pending)
    const edited = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    store.onTreeChange(edited); // lands BEFORE the probe resolves
    await vi.advanceTimersByTimeAsync(200);

    expect(http.putCalls).toHaveLength(1); // the optimistic write WAS attempted
    expect(store.providerState).toBe("absent");
    expect(store.tree).toEqual(edited); // no rollback — there is no server tree
    expect(warnings).toHaveLength(1); // the once-per-absence log, nothing more
  });
});

describe("layout store — provider present", () => {
  it("a 200 probe replaces the tree and marks the provider present", async () => {
    const served = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp(() => ({ ok: true, tree: served }));
    const store = makeStore(http);

    await store.probe("ws-a");
    expect(store.providerState).toBe("present");
    expect(store.tree).toEqual(served);
    expect(warnings).toEqual([]);
  });
});

describe("layout store — WS push (§2.5)", () => {
  it("a layout push for the ACTIVE workspace replaces the tree", async () => {
    const served = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp(() => ({ ok: true, tree: served }));
    const store = makeStore(http);
    await store.probe("ws-a");

    const pushed = overlaySidePanels(DEFAULT_LAYOUT, ["vision"]);
    store.onServerTree("ws-a", pushed);
    expect(store.tree).toEqual(pushed);
  });

  it("a push for a NON-active workspace is ignored", async () => {
    const served = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp(() => ({ ok: true, tree: served }));
    const store = makeStore(http);
    await store.probe("ws-a");

    const other = overlaySidePanels(DEFAULT_LAYOUT, ["vision"]);
    store.onServerTree("ws-b", other);
    expect(store.tree).toEqual(served);
  });

  it("after a workspace switch the OLD workspace's push is ignored (clients filter)", async () => {
    const servedA = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    let served = servedA;
    const http = fakeHttp(() => ({ ok: true, tree: served }));
    const store = makeStore(http);
    await store.probe("ws-a");

    const servedB = overlaySidePanels(DEFAULT_LAYOUT, ["vision"]);
    served = servedB;
    store.onWorkspaceChanged("ws-b");
    await vi.advanceTimersByTimeAsync(0); // the probe's promise
    expect(store.tree).toEqual(servedB);

    // A late push for the OLD workspace must not land.
    const stale = overlaySidePanels(DEFAULT_LAYOUT, ["tasks"]);
    store.onServerTree("ws-a", stale);
    expect(store.tree).toEqual(servedB);
  });
});

describe("layout store — edits PUT the whole tree + rollback (§2.6)", () => {
  it("an edit PUTs the WHOLE tree, debounced; a 200 echo becomes the rollback target", async () => {
    const served = DEFAULT_LAYOUT;
    const http = fakeHttp(() => ({ ok: true, tree: served }));
    const store = makeStore(http);
    await store.probe("ws-a");

    const edited = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    store.onTreeChange(edited);
    // Not yet — debounced.
    expect(http.putCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    expect(http.putCalls).toEqual([{ workspaceId: "ws-a", tree: edited }]);
    expect(warnings).toEqual([]);
  });

  it("rapid edits coalesce into ONE debounced PUT of the latest tree", async () => {
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    const store = makeStore(http);
    await store.probe("ws-a");

    store.onTreeChange(overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]));
    await vi.advanceTimersByTimeAsync(50);
    store.onTreeChange(overlaySidePanels(DEFAULT_LAYOUT, ["vision"]));
    await vi.advanceTimersByTimeAsync(200);

    expect(http.putCalls).toHaveLength(1);
    expect(http.putCalls[0]?.tree).toEqual(overlaySidePanels(DEFAULT_LAYOUT, ["vision"]));
  });

  it("a 400 rejection rolls back to the last server tree with a quiet warning", async () => {
    const served = DEFAULT_LAYOUT;
    const http = fakeHttp(
      () => ({ ok: true, tree: served }),
      () => ({ ok: false, notFound: false, error: "invalid tree" }),
    );
    const store = makeStore(http);
    await store.probe("ws-a");
    expect(store.providerState).toBe("present");

    const bad = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    store.onTreeChange(bad);
    await vi.advanceTimersByTimeAsync(200);

    expect(store.tree).toEqual(served); // rolled back
    expect(store.providerState).toBe("present"); // the provider is still there
    expect(warnings.some((w) => w.includes("rolled back"))).toBe(true);
  });

  it("a 5xx failure rolls back too (present provider, transient error)", async () => {
    const served = DEFAULT_LAYOUT;
    let failPut = false;
    const http = fakeHttp(
      () => ({ ok: true, tree: served }),
      () =>
        failPut
          ? { ok: false, notFound: false, error: "storage down" }
          : { ok: true, tree: served },
    );
    const store = makeStore(http);
    await store.probe("ws-a");

    failPut = true;
    store.onTreeChange(overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]));
    await vi.advanceTimersByTimeAsync(200);
    expect(store.tree).toEqual(served);
  });

  it("a PUT 404 does NOT roll back — the provider vanished mid-session; the edit stays ephemeral", async () => {
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    const store = makeStore(http);
    await store.probe("ws-a");

    // The provider unloads before the edit's PUT fires.
    http.putResult = () => ({ ok: false, notFound: true, error: "No layout provider is active" });
    const edited = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    store.onTreeChange(edited);
    await vi.advanceTimersByTimeAsync(200);

    expect(store.tree).toEqual(edited); // the edit STAYS (in-memory)
    expect(store.providerState).toBe("absent");
    expect(warnings).toHaveLength(1); // the once-per-absence log, nothing more
  });
});

describe("layout store — probe triggers (§2.6)", () => {
  it("a per-workspace plugin-state change on the ACTIVE workspace re-probes (the plugins-modal toggle)", async () => {
    let absent = true;
    const served = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp(() =>
      absent
        ? { ok: false, notFound: true, error: "No layout plugin is enabled in this workspace" }
        : { ok: true, tree: served },
    );
    const store = makeStore(http);
    await store.probe("ws-a");
    expect(store.providerState).toBe("absent");

    absent = false; // a layout plugin got enabled in THIS workspace
    store.onWorkspacePluginsChanged("ws-a");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.providerState).toBe("present");
    expect(store.tree).toEqual(served);
  });

  it("a per-workspace plugin-state change on ANOTHER workspace is ignored (its probe fetches on switch)", async () => {
    let absent = true;
    const served = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp(() =>
      absent
        ? { ok: false, notFound: true, error: "No layout plugin is enabled in this workspace" }
        : { ok: true, tree: served },
    );
    const store = makeStore(http);
    await store.probe("ws-a");
    expect(store.providerState).toBe("absent");

    absent = false; // a DIFFERENT workspace's toggle — nothing re-renders here
    store.onWorkspacePluginsChanged("ws-other");
    await vi.advanceTimersByTimeAsync(0);
    expect(http.getCalls).toEqual(["ws-a"]); // no second probe
    expect(store.providerState).toBe("absent");
  });

  it("extensions-changed re-probes the active workspace", async () => {
    let absent = true;
    const served = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp(() =>
      absent
        ? { ok: false, notFound: true, error: "No layout provider is active" }
        : { ok: true, tree: served },
    );
    const store = makeStore(http);
    await store.probe("ws-a");
    expect(store.providerState).toBe("absent");

    absent = false; // a layout plugin got enabled on the server
    store.onExtensionsChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.providerState).toBe("present");
    expect(store.tree).toEqual(served);
  });

  it("a workspace switch resets to the default, probes the NEW workspace, and drops queued edits", async () => {
    const http = fakeHttp((ws) =>
      ws === "ws-b"
        ? { ok: true, tree: overlaySidePanels(DEFAULT_LAYOUT, ["vision"]) }
        : { ok: true, tree: DEFAULT_LAYOUT },
    );
    const store = makeStore(http);
    await store.probe("ws-a");

    // Queue an edit for ws-a, then switch before the debounce fires.
    store.onTreeChange(overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]));
    store.onWorkspaceChanged("ws-b");
    await vi.advanceTimersByTimeAsync(300);

    expect(store.activeWorkspaceId).toBe("ws-b");
    expect(http.getCalls).toEqual(["ws-a", "ws-b"]);
    expect(store.tree).toEqual(overlaySidePanels(DEFAULT_LAYOUT, ["vision"]));
    // The queued edit never PUTs — it belonged to the old workspace.
    expect(http.putCalls).toEqual([]);
  });

  it("switching to the SAME workspace is a no-op (no re-probe, no reset)", async () => {
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    const store = makeStore(http);
    await store.probe("ws-a");
    store.onWorkspaceChanged("ws-a");
    expect(http.getCalls).toEqual(["ws-a"]);
  });
});

describe("layout store — one-way localStorage migration (§2.7)", () => {
  it("boot probe + equal panels + stored key → exactly ONE migration PUT, then the key is dead", async () => {
    const storage = storageWith(["extensions", "vision"]);
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    const store = makeStore(http, { storage });

    await store.probe("ws-a", { boot: true });
    expect(http.putCalls).toEqual([
      { workspaceId: "ws-a", tree: overlaySidePanels(DEFAULT_LAYOUT, ["extensions", "vision"]) },
    ]);
    // The migrated tree is now the rendered tree.
    expect(store.tree).toEqual(overlaySidePanels(DEFAULT_LAYOUT, ["extensions", "vision"]));

    // The key is never read again: a later probe PUTs nothing.
    await store.probe("ws-a");
    expect(http.putCalls).toHaveLength(1);
  });

  it("no stored key → no migration PUT (but the read-once flag is still consumed)", async () => {
    const storage = storageWith(null);
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    const store = makeStore(http, { storage });
    await store.probe("ws-a", { boot: true });
    expect(http.putCalls).toEqual([]);
  });

  it("a custom provider tree (panels differ) is NOT migrated over", async () => {
    const storage = storageWith(["extensions"]);
    const custom = overlaySidePanels(DEFAULT_LAYOUT, ["vision"]);
    const http = fakeHttp(() => ({ ok: true, tree: custom }));
    const store = makeStore(http, { storage });
    await store.probe("ws-a", { boot: true });
    expect(http.putCalls).toEqual([]);
    expect(store.tree).toEqual(custom);
  });

  it("migration is boot-only: a non-boot probe never PUTs the stored selection", async () => {
    const storage = storageWith(["extensions"]);
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    const store = makeStore(http, { storage });
    await store.probe("ws-a");
    expect(http.putCalls).toEqual([]);
  });

  it("a failed migration PUT consumes the flag (best-effort — never retried, never fatal)", async () => {
    const storage = storageWith(["extensions"]);
    const http = fakeHttp(
      () => ({ ok: true, tree: DEFAULT_LAYOUT }),
      () => ({ ok: false, notFound: false, error: "invalid tree" }),
    );
    const store = makeStore(http, { storage });
    await store.probe("ws-a", { boot: true });
    expect(http.putCalls).toHaveLength(1);
    expect(warnings.some((w) => w.includes("migration"))).toBe(true);
    // The rendered tree is untouched (the PUT failed).
    expect(store.tree).toEqual(DEFAULT_LAYOUT);
    await store.probe("ws-a");
    expect(http.putCalls).toHaveLength(1);
  });

  it("migration arms even when the boot probe 404s, and applies on the first LATER success", async () => {
    const storage = storageWith(["extensions"]);
    let absent = true;
    const http = fakeHttp(() =>
      absent
        ? { ok: false, notFound: true, error: "No layout provider is active" }
        : { ok: true, tree: DEFAULT_LAYOUT },
    );
    const store = makeStore(http, { storage });
    await store.probe("ws-a", { boot: true });
    expect(http.putCalls).toEqual([]);

    absent = false;
    await store.probe("ws-a"); // extensions-changed probe — first success
    expect(http.putCalls).toEqual([
      { workspaceId: "ws-a", tree: overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]) },
    ]);
  });
});

describe("layout store — resetToDefault (plan 04 §4.4, the reset affordance)", () => {
  it("DELETEs the workspace's layout, applies the fresh seed, and resolves null", async () => {
    const custom = overlaySidePanels(DEFAULT_LAYOUT, ["extensions"]);
    const http = fakeHttp();
    // The DELETE returns the FRESH SEED (the server re-seeded).
    http.deleteResult = () => ({ ok: true, tree: DEFAULT_LAYOUT });
    const store = makeStore(http);

    // Get to a NON-default tree first: a present provider + a pushed edit.
    http.getResult = () => ({ ok: true, tree: custom });
    await store.probe("ws-a");
    expect(store.tree).toEqual(custom);

    const failure = await store.resetToDefault("ws-a");
    expect(failure).toBeNull();
    expect(http.deleteCalls).toEqual(["ws-a"]);
    // The fresh seed is applied locally (the WS broadcast echo is idempotent).
    expect(store.tree).toEqual(DEFAULT_LAYOUT);
    expect(store.providerState).toBe("present");
  });

  it("a 404 (no provider) resolves to the user-facing 'no layout plugin enabled' reason", async () => {
    const http = fakeHttp();
    http.deleteResult = () => ({
      ok: false,
      notFound: true,
      error: "No layout provider is active",
    });
    const store = makeStore(http);

    const failure = await store.resetToDefault("ws-a");
    expect(failure).toBe("no layout plugin enabled");
    expect(store.tree).toEqual(DEFAULT_LAYOUT); // untouched local default
  });

  it("another failure (5xx on a present provider) resolves to its error message", async () => {
    const http = fakeHttp(() => ({ ok: true, tree: DEFAULT_LAYOUT }));
    http.deleteResult = () => ({ ok: false, notFound: false, error: "storage write failed" });
    const store = makeStore(http);
    await store.probe("ws-a");

    const failure = await store.resetToDefault("ws-a");
    expect(failure).toBe("storage write failed");
  });
});
