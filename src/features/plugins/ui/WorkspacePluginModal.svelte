<script lang="ts">
  import { onMount } from "svelte";
  import type { PluginsStore } from "../store.svelte";
  import { rowBlockReason, rowChecked, rowSelectable, stateLabel } from "../logic/workspace-row";
  import type { WorkspaceLayoutPort } from "../logic/types";
  import ResetLayoutConfirm from "./ResetLayoutConfirm.svelte";

  let {
    workspaceId,
    workspaceTitle,
    plugins,
    layout,
    onClose,
  }: {
    workspaceId: string;
    /** The workspace's display title (modal heading). */
    workspaceTitle: string;
    plugins: PluginsStore;
    /**
     * The layout port (plan 04 §4.4) — gates + powers the "Reset layout to
     * default" affordance. Absent → the section doesn't render (tests).
     */
    layout?: WorkspaceLayoutPort;
    onClose: () => void;
  } = $props();

  onMount(() => {
    // Load only when the view isn't already showing THIS workspace (reopening
    // the same modal never flashes; a different id reloads it).
    if (plugins.workspaceView?.workspaceId !== workspaceId) {
      void plugins.openWorkspace(workspaceId);
    }
  });

  // The default workspace is the template (§7): its states are what other
  // workspaces inherit when they first open.
  const isTemplate = $derived(workspaceId === "default");

  async function toggle(pluginId: string, checked: boolean): Promise<void> {
    await plugins.setWorkspaceState(workspaceId, pluginId, checked ? "enabled" : "disabled");
  }

  // ── The reset affordance (plan 04 §4.4) ─────────────────────────────────
  let resetOpen = $state(false);
  let resetting = $state(false);
  let resetError = $state<string | null>(null);

  async function confirmReset(): Promise<void> {
    if (layout === undefined || resetting) return;
    resetting = true;
    resetError = null;
    const failure = await layout.reset(workspaceId);
    resetting = false;
    resetOpen = false;
    if (failure !== null) resetError = failure;
  }
</script>

<div class="modal modal-open" role="dialog" aria-label={`Plugins for ${workspaceTitle}`}>
  <div class="modal-box max-w-2xl">
    <h3 class="text-lg font-bold">Plugins — {workspaceTitle}</h3>
    <p class="mt-1 text-xs opacity-60">
      What THIS workspace uses. Unloaded plugins are greyed out — only the global plugin manager
      loads code.
    </p>
    {#if isTemplate}
      <p class="mt-1 text-xs text-info">
        This is the default workspace — other workspaces inherit these states when they first open.
      </p>
    {/if}

    {#if plugins.error}
      <p class="mt-2 text-xs text-error" role="alert">{plugins.error}</p>
    {/if}

    {#if plugins.workspaceView === null}
      <div class="flex h-24 items-center justify-center">
        <span class="loading loading-spinner loading-sm opacity-60"></span>
      </div>
    {:else}
      <table class="table table-sm mt-2">
        <thead>
          <tr>
            <th class="w-10">
              <span class="sr-only">Enabled</span>
            </th>
            <th>Plugin</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {#each plugins.workspaceView.rows as row (row.pluginId)}
            <tr class={row.loaded ? "" : "opacity-50"}>
              <td>
                {#if rowSelectable(row)}
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    checked={rowChecked(row)}
                    aria-label={`${rowChecked(row) ? "Disable" : "Enable"} ${row.pluginId} in this workspace`}
                    onchange={(e) => toggle(row.pluginId, e.currentTarget.checked)}
                  />
                {:else}
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    checked={rowChecked(row)}
                    disabled
                    aria-label={`${row.pluginId} (unavailable in this workspace)`}
                    title={rowBlockReason(row) ?? undefined}
                  />
                {/if}
              </td>
              <td>
                <span class="font-medium">{row.pluginId}</span>
                <span class="badge badge-ghost badge-sm ml-2 text-xs">{row.tier}</span>
              </td>
              <td class="text-xs opacity-70">
                {stateLabel(row.state)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if layout}
      <div class="mt-3 border-t border-base-300 pt-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium">Layout</p>
            {#if layout.providerActive}
              <p class="text-xs opacity-60">Managed by the active layout plugin.</p>
            {:else}
              <p class="text-xs opacity-60">No layout plugin enabled — no layout to reset.</p>
            {/if}
          </div>
          <button
            type="button"
            class="btn btn-warning btn-sm"
            disabled={!layout.providerActive || resetting}
            title={layout.providerActive
              ? "Restore this workspace's default layout"
              : "No layout plugin enabled"}
            onclick={() => (resetOpen = true)}
          >
            Reset layout to default
          </button>
        </div>
        {#if resetError}
          <p class="mt-1 text-xs text-error" role="alert">Resetting the layout failed: {resetError}</p>
        {/if}
      </div>
    {/if}

    <div class="modal-action">
      <button type="button" class="btn btn-sm" onclick={onClose}>Close</button>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onClose}></div>
</div>

{#if resetOpen && layout}
  <ResetLayoutConfirm onConfirm={() => void confirmReset()} onCancel={() => (resetOpen = false)} />
{/if}
