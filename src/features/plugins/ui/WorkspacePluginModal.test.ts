import type { WorkspacePluginsResponse } from "@dispatch/transport-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PluginsHttp } from "../adapter/http";
import { createPluginsStore } from "../store.svelte";
import WorkspacePluginModal from "./WorkspacePluginModal.svelte";

const wsResponse: WorkspacePluginsResponse = {
  workspaceId: "ws",
  plugins: [
    // Core: enabled + locked (the server materializes core to enabled and
    // refuses its PUT with a 409 core-locked — plan 06 §6.6).
    { pluginId: "kernel", tier: "core", state: "enabled", loaded: true, locked: true },
    // Loaded standard: interactive.
    { pluginId: "mcp", tier: "standard", state: "undefined", loaded: true, locked: false },
    // UNLOADED: greyed out + unselectable (§7 strict layering).
    { pluginId: "notloaded", tier: "standard", state: "disabled", loaded: false, locked: false },
  ],
  enabledProviderCount: 1,
};

function fakeHttp(overrides: Partial<PluginsHttp> = {}): PluginsHttp {
  return {
    list: vi.fn(async () => null),
    scan: vi.fn(),
    load: vi.fn(),
    unload: vi.fn(),
    reload: vi.fn(),
    workspacePlugins: vi.fn(async () => wsResponse),
    setWorkspaceState: vi.fn(async () => ({
      ok: true,
      response: { workspaceId: "ws", pluginId: "mcp", state: "enabled" },
    })),
    providersStatus: vi.fn(async () => ({ workspaceId: "ws", enabledProviderCount: 1 })),
    ...overrides,
  } as unknown as PluginsHttp;
}

async function renderModal(http: PluginsHttp = fakeHttp()) {
  const store = createPluginsStore(http);
  await store.openWorkspace("ws");
  render(WorkspacePluginModal, {
    props: { workspaceId: "ws", workspaceTitle: "My Workspace", plugins: store, onClose: vi.fn() },
  });
  return { store, http };
}

describe("WorkspacePluginModal", () => {
  it("renders the workspace's plugin rows", async () => {
    await renderModal();
    expect(screen.getByText("Plugins — My Workspace")).toBeInTheDocument();
    expect(screen.getByText("kernel")).toBeInTheDocument();
    expect(screen.getByText("mcp")).toBeInTheDocument();
  });

  it("checkboxes reflect the workspace state (enabled=checked, undefined=unchecked)", async () => {
    await renderModal();
    expect(screen.getByRole("checkbox", { name: /kernel/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Enable mcp/i })).not.toBeChecked();
  });

  it("unloaded plugins are greyed out AND unselectable (§7)", async () => {
    await renderModal();
    const checkbox = screen.getByRole("checkbox", { name: /notloaded/i });
    expect(checkbox).toBeDisabled();
    // The row is visually greyed (the opacity marker class).
    expect(checkbox.closest("tr")?.className).toContain("opacity-50");
    // The tooltip points at the global manager.
    expect(checkbox.getAttribute("title")).toMatch(/plugin manager/i);
  });

  it("core rows render locked (checked but unselectable — the server refuses the PUT)", async () => {
    await renderModal();
    const checkbox = screen.getByRole("checkbox", { name: /kernel/i });
    expect(checkbox).toBeDisabled();
    expect(checkbox.getAttribute("title")).toMatch(/Core plugins are enabled by default/i);
  });

  it("checking a selectable row writes enabled via the store", async () => {
    const user = userEvent.setup();
    const { http } = await renderModal();
    await user.click(screen.getByRole("checkbox", { name: /Enable mcp/i }));
    expect(http.setWorkspaceState).toHaveBeenCalledWith("ws", "mcp", "enabled");
  });

  it("unchecking a checked row writes disabled", async () => {
    const user = userEvent.setup();
    const enabled: WorkspacePluginsResponse = {
      workspaceId: "ws",
      plugins: [
        { pluginId: "mcp", tier: "standard", state: "enabled", loaded: true, locked: false },
      ],
      enabledProviderCount: 1,
    };
    const fake = fakeHttp({ workspacePlugins: async () => enabled });
    const store = createPluginsStore(fake);
    await store.openWorkspace("ws");
    render(WorkspacePluginModal, {
      props: {
        workspaceId: "ws",
        workspaceTitle: "My Workspace",
        plugins: store,
        onClose: vi.fn(),
      },
    });
    await user.click(screen.getByRole("checkbox", { name: /Disable mcp/i }));
    expect(fake.setWorkspaceState).toHaveBeenCalledWith("ws", "mcp", "disabled");
  });

  it("shows the template hint for the default workspace", async () => {
    const store = createPluginsStore(fakeHttp());
    await store.openWorkspace("default");
    render(WorkspacePluginModal, {
      props: {
        workspaceId: "default",
        workspaceTitle: "Default",
        plugins: store,
        onClose: vi.fn(),
      },
    });
    expect(screen.getByText(/other workspaces inherit these states/i)).toBeInTheDocument();
  });
});
