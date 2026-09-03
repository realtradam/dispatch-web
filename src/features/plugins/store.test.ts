import type { PluginListResponse, WorkspacePluginsResponse } from "@dispatch/transport-contract";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginOpResult,
  PluginScanResult,
  PluginsHttp,
  WorkspaceStateResult,
} from "./adapter/http";
import { createPluginsStore } from "./store.svelte";

const listResponse: PluginListResponse = {
  loaded: [
    {
      id: "kernel",
      name: "Kernel",
      version: "1.0.0",
      tier: "core",
      trust: "bundled",
      locked: true,
      dependsOn: [],
    },
  ],
  disabledWithReason: [],
  discovered: [
    {
      id: "fresh",
      name: "Fresh",
      version: "1.0.0",
      tier: "standard",
      trust: "external",
      dir: "/plugins/fresh",
    },
  ],
  missing: [],
};

const wsResponse: WorkspacePluginsResponse = {
  workspaceId: "ws",
  plugins: [
    { pluginId: "kernel", tier: "core", state: "enabled", loaded: true, locked: true },
    { pluginId: "mcp", tier: "standard", state: "undefined", loaded: true, locked: false },
  ],
  enabledProviderCount: 1,
};

/** A fake PluginsHttp with a controllable list + workspace response. */
function fakeHttp(opts: {
  list?: PluginListResponse | null;
  workspacePlugins?: WorkspacePluginsResponse | null;
}) {
  // `=== undefined` (not `??`) so an explicit `null` override defeats the default.
  const list = () => (opts.list === undefined ? listResponse : opts.list);
  const ws = () => (opts.workspacePlugins === undefined ? wsResponse : opts.workspacePlugins);
  const opOk = (action: "load" | "unload" | "reload") => ({ ok: true, action, id: "x" }) as const;
  return {
    list: vi.fn(async (): Promise<PluginListResponse | null> => list()),
    scan: vi.fn(
      async (): Promise<PluginScanResult> => ({
        ok: true,
        response: { root: "/plugins", newPlugins: [], invalid: [], incompatible: [] },
      }),
    ),
    load: vi.fn(async (): Promise<PluginOpResult> => ({ ok: true, response: opOk("load") })),
    unload: vi.fn(async (): Promise<PluginOpResult> => ({ ok: true, response: opOk("unload") })),
    reload: vi.fn(async (): Promise<PluginOpResult> => ({ ok: true, response: opOk("reload") })),
    workspacePlugins: vi.fn(async (): Promise<WorkspacePluginsResponse | null> => ws()),
    setWorkspaceState: vi.fn(
      async (): Promise<WorkspaceStateResult> => ({
        ok: true,
        response: { workspaceId: "ws", pluginId: "mcp", state: "enabled" },
      }),
    ),
    providersStatus: vi.fn(async () => ({ workspaceId: "ws", enabledProviderCount: 1 })),
  } satisfies PluginsHttp;
}

describe("createPluginsStore — manager list", () => {
  it("fetches + normalizes the list into nodes", async () => {
    const store = createPluginsStore(fakeHttp({}));
    expect(store.list).toBeNull();
    expect(store.nodes).toEqual([]);
    await store.refresh();
    expect(store.list).toEqual(listResponse);
    expect(store.nodes.map((n) => n.id)).toEqual(["kernel", "fresh"]);
  });

  it("mutation results are surfaced and the list is refetched", async () => {
    const http = fakeHttp({});
    const store = createPluginsStore(http);
    await store.refresh();
    const result = await store.unload("kernel", false);
    expect(result.ok).toBe(true);
    expect(http.unload).toHaveBeenCalledWith("kernel", false);
    expect(http.list).toHaveBeenCalledTimes(2);
  });

  it("scan records the result + refreshes", async () => {
    const http = fakeHttp({});
    const store = createPluginsStore(http);
    await store.scan();
    expect(store.lastScan?.ok).toBe(true);
    expect(http.scan).toHaveBeenCalledOnce();
    expect(http.list).toHaveBeenCalledTimes(1); // refresh after scan (initial list fetch absent)
  });

  it("a mutation error lands in store.error", async () => {
    const http = fakeHttp({});
    http.unload = vi.fn(async (): Promise<PluginOpResult> => ({ ok: false, error: "blocked" }));
    const store = createPluginsStore(http);
    await store.unload("kernel", false);
    expect(store.error).toBe("blocked");
  });
});

describe("createPluginsStore — workspace view", () => {
  it("openWorkspace loads the rows + enabled provider count", async () => {
    const store = createPluginsStore(fakeHttp({}));
    await store.openWorkspace("ws");
    expect(store.workspaceView).toEqual({
      workspaceId: "ws",
      rows: wsResponse.plugins,
      enabledProviderCount: 1,
    });
  });

  it("setWorkspaceState updates the row in place from the response", async () => {
    const store = createPluginsStore(fakeHttp({}));
    await store.openWorkspace("ws");
    await store.setWorkspaceState("ws", "mcp", "enabled");
    const row = store.workspaceView?.rows.find((r) => r.pluginId === "mcp");
    expect(row?.state).toBe("enabled");
  });

  it("a refused setWorkspaceState refetches (server-authoritative reconcile)", async () => {
    const http = fakeHttp({});
    http.setWorkspaceState = vi.fn(
      async (): Promise<WorkspaceStateResult> => ({
        ok: false,
        error: "core is locked",
        reason: "core-locked",
      }),
    );
    const store = createPluginsStore(http);
    await store.openWorkspace("ws");
    await store.setWorkspaceState("ws", "kernel", "disabled");
    expect(store.error).toBe("core is locked");
    expect(http.workspacePlugins).toHaveBeenCalledTimes(2);
  });

  it("a failed openWorkspace clears the view (no stale rows from another workspace)", async () => {
    const http = fakeHttp({ workspacePlugins: null });
    const store = createPluginsStore(http);
    await store.openWorkspace("other");
    expect(store.workspaceView).toBeNull();
    expect(store.error).toContain("other");
  });
});

describe("createPluginsStore — multi-client coherence (§11)", () => {
  it("onExtensionsChanged refetches the list + the open workspace view", async () => {
    const http = fakeHttp({});
    const store = createPluginsStore(http);
    await store.openWorkspace("ws");
    expect(http.list).toHaveBeenCalledTimes(0);
    expect(http.workspacePlugins).toHaveBeenCalledTimes(1);

    store.onExtensionsChanged();
    await vi.waitFor(() => {
      expect(http.list).toHaveBeenCalledTimes(1);
      expect(http.workspacePlugins).toHaveBeenCalledTimes(2);
    });
  });

  it("onExtensionsChanged does not refetch a workspace view when none is open", async () => {
    const http = fakeHttp({});
    const store = createPluginsStore(http);
    store.onExtensionsChanged();
    await vi.waitFor(() => {
      expect(http.list).toHaveBeenCalledTimes(1);
      expect(http.workspacePlugins).toHaveBeenCalledTimes(0);
    });
  });
});
