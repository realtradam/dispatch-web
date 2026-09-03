import type { PluginListResponse } from "@dispatch/transport-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PluginOpResult, PluginsHttp } from "../adapter/http";
import { createPluginsStore } from "../store.svelte";
import PluginManager from "./PluginManager.svelte";

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
    {
      id: "opencode",
      name: "OpenCode",
      version: "2.0.0",
      tier: "providers",
      trust: "bundled",
      locked: false,
      dependsOn: [],
    },
    {
      id: "transport-http",
      name: "Transport HTTP",
      version: "1.1.0",
      tier: "standard",
      trust: "bundled",
      locked: false,
      dependsOn: ["heartbeat"],
    },
    {
      id: "heartbeat",
      name: "Heartbeat",
      version: "1.1.0",
      tier: "standard",
      trust: "bundled",
      locked: false,
      dependsOn: [],
    },
  ],
  disabledWithReason: [
    {
      id: "broken",
      name: "Broken",
      version: "0.1.0",
      tier: "standard",
      trust: "local",
      reason: "activation threw",
    },
  ],
  discovered: [
    {
      id: "fresh",
      name: "Fresh",
      version: "3.0.0",
      tier: "standard",
      trust: "external",
      dir: "/plugins/fresh",
    },
  ],
  missing: [{ id: "gone", reason: "directory is gone" }],
};

/** A fake PluginsHttp (the OUTERMOST edge — the store itself is real). */
function fakeHttp(overrides: Partial<PluginsHttp> = {}): PluginsHttp {
  return {
    list: vi.fn(async () => listResponse),
    scan: vi.fn(async () => ({
      ok: true,
      response: { root: "/plugins", newPlugins: [], invalid: [], incompatible: [] },
    })),
    load: vi.fn(async () => ({ ok: true, response: { ok: true, action: "load", id: "x" } })),
    unload: vi.fn(async () => ({ ok: true, response: { ok: true, action: "unload", id: "x" } })),
    reload: vi.fn(async () => ({ ok: true, response: { ok: true, action: "reload", id: "x" } })),
    workspacePlugins: vi.fn(async () => null),
    setWorkspaceState: vi.fn(async () => ({
      ok: true,
      response: { workspaceId: "ws", pluginId: "x", state: "enabled" },
    })),
    providersStatus: vi.fn(async () => ({ workspaceId: "ws", enabledProviderCount: 1 })),
    ...overrides,
  } as unknown as PluginsHttp;
}

async function renderManager(http: PluginsHttp = fakeHttp()) {
  const store = createPluginsStore(http);
  await store.refresh();
  render(PluginManager, { props: { plugins: store, onClose: vi.fn() } });
  return { store, http };
}

describe("PluginManager — tables + locked core", () => {
  it("renders the loaded table with tier groups and the discovered table", async () => {
    await renderManager();
    expect(screen.getByText("Loaded")).toBeInTheDocument();
    expect(screen.getByText("Discovered (not loaded)")).toBeInTheDocument();
    // Tier subheadings (Core / Provider / Standard) — each also appears as a
    // row badge, so assert at least one occurrence of each.
    expect(screen.getAllByText("Core").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Provider").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Standard").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Missing (directory gone)")).toBeInTheDocument();
    expect(screen.getByText("gone")).toBeInTheDocument();
  });

  it("core rows show a lock instead of a checkbox", async () => {
    await renderManager();
    // The kernel row has no checkbox (the lock glyph instead).
    expect(screen.queryByRole("checkbox", { name: /Unload kernel/i })).not.toBeInTheDocument();
    // Provider + standard rows have checkboxes.
    expect(screen.getByRole("checkbox", { name: /Unload opencode/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Unload heartbeat/i })).toBeChecked();
  });

  it("disabled-with-reason rows show their reason", async () => {
    await renderManager();
    expect(screen.getByText("activation threw")).toBeInTheDocument();
  });
});

describe("PluginManager — cascade-uncheck warning (§8)", () => {
  it("unchecking a plugin with loaded dependents warns first (no request yet)", async () => {
    const user = userEvent.setup();
    const { http } = await renderManager();
    // transport-http depends on heartbeat → unchecking heartbeat cascades.
    await user.click(screen.getByRole("checkbox", { name: /Unload heartbeat/i }));
    expect(http.unload).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Unload heartbeat/i })).toBeInTheDocument();
    expect(screen.getByText(/also unchecks: transport-http/)).toBeInTheDocument();
  });

  it("accepting the warning issues the forced unload (the cascade is server-side)", async () => {
    const user = userEvent.setup();
    const { http } = await renderManager();
    await user.click(screen.getByRole("checkbox", { name: /Unload heartbeat/i }));
    await user.click(screen.getByRole("button", { name: "Unload with force" }));
    expect(http.unload).toHaveBeenCalledWith("heartbeat", true);
    expect(screen.queryByRole("dialog", { name: /Unload heartbeat/i })).not.toBeInTheDocument();
  });

  it("cancelling the warning issues nothing", async () => {
    const user = userEvent.setup();
    const { http } = await renderManager();
    await user.click(screen.getByRole("checkbox", { name: /Unload heartbeat/i }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(http.unload).not.toHaveBeenCalled();
  });

  it("unchecking WITHOUT dependents unloads directly (no warning)", async () => {
    const user = userEvent.setup();
    const { http } = await renderManager();
    // transport-http has no loaded dependents (it DEPENDS on heartbeat, not
    // the reverse) — and it is not a provider, so the last-provider lock
    // (which correctly disables `opencode`, the fixture's only provider)
    // does not apply.
    await user.click(screen.getByRole("checkbox", { name: /Unload transport-http/i }));
    expect(http.unload).toHaveBeenCalledWith("transport-http", false);
    expect(screen.queryByRole("dialog", { name: /Unload/i })).not.toBeInTheDocument();
  });

  it("a refused unload offers force with the global-stop copy (§8 in-use force)", async () => {
    const user = userEvent.setup();
    const http = fakeHttp({
      unload: vi.fn(
        async (): Promise<PluginOpResult> => ({
          ok: false,
          error: "the engine refused — the plugin is in use",
          reason: "engine-refused",
        }),
      ),
    });
    await renderManager(http);
    await user.click(screen.getByRole("checkbox", { name: /Unload transport-http/i }));
    // The refusal is surfaced both in the manager's error line and the
    // confirm dialog's notice (the dialog appears after the async refusal).
    expect(
      await screen.findAllByText(/the engine refused/).then((els) => els.length),
    ).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/stops ALL agents globally/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Force unload" }));
    expect(http.unload).toHaveBeenLastCalledWith("transport-http", true);
  });
});

describe("PluginManager — last-provider lock (§8)", () => {
  it("the last loaded provider's checkbox is disabled with a tooltip", async () => {
    const single: PluginListResponse = {
      loaded: [
        {
          id: "opencode",
          name: "OpenCode",
          version: "2.0.0",
          tier: "providers",
          trust: "bundled",
          locked: false,
          dependsOn: [],
        },
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
      discovered: [],
      missing: [],
    };
    const store = createPluginsStore(fakeHttp({ list: async () => single }));
    await store.refresh();
    render(PluginManager, { props: { plugins: store, onClose: vi.fn() } });
    const checkbox = screen.getByRole("checkbox", { name: /Unload opencode/i });
    expect(checkbox).toBeDisabled();
    // The explanatory copy is wired via the title attribute (the tooltip).
    expect(checkbox.getAttribute("title")).toMatch(/last provider/i);
  });
});

describe("PluginManager — load with auto-checked prereqs (§8)", () => {
  it("checking a discovered plugin loads it and reflects the stateful refetch", async () => {
    const user = userEvent.setup();
    // Stateful fake: after `load("fresh")`, the list reports fresh as loaded
    // (the store refetches from the server after the op — the checkbox must
    // reflect the NEW list, not a local guess).
    let freshLoaded = false;
    const stateful: PluginsHttp = {
      ...fakeHttp(),
      list: vi.fn(async () =>
        freshLoaded
          ? {
              ...listResponse,
              discovered: [],
              loaded: [
                ...listResponse.loaded,
                {
                  id: "fresh",
                  name: "Fresh",
                  version: "3.0.0",
                  tier: "standard",
                  trust: "external",
                  locked: false,
                  dependsOn: [],
                },
              ],
            }
          : listResponse,
      ),
      load: vi.fn(async (id: string) => {
        if (id === "fresh") freshLoaded = true;
        return { ok: true, response: { ok: true, action: "load", id } };
      }),
    } as unknown as PluginsHttp;
    const store = createPluginsStore(stateful);
    await store.refresh();
    render(PluginManager, { props: { plugins: store, onClose: vi.fn() } });
    await user.click(screen.getByRole("checkbox", { name: /Load fresh/i }));
    expect(stateful.load).toHaveBeenCalledWith("fresh");
    expect(screen.getByRole("checkbox", { name: /Unload fresh/i })).toBeChecked();
  });

  it("the Scan button triggers a manual scan", async () => {
    const user = userEvent.setup();
    const { http } = await renderManager();
    await user.click(screen.getByRole("button", { name: /Scan/ }));
    expect(http.scan).toHaveBeenCalledOnce();
  });

  it("the Reload affordance calls reload for a loaded row", async () => {
    const user = userEvent.setup();
    const { http } = await renderManager();
    await user.click(screen.getByRole("button", { name: /Reload transport-http/i }));
    expect(http.reload).toHaveBeenCalledWith("transport-http");
  });
});
