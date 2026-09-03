<script lang="ts">
  import { onMount } from "svelte";
  import type { PluginsStore } from "../store.svelte";
  import { rowBlockReason, rowChecked, rowSelectable, stateLabel } from "../logic/workspace-row";

  let {
    workspaceId,
    workspaceTitle,
    plugins,
    onClose,
  }: {
    workspaceId: string;
    /** The workspace's display title (modal heading). */
    workspaceTitle: string;
    plugins: PluginsStore;
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

    <div class="modal-action">
      <button type="button" class="btn btn-sm" onclick={onClose}>Close</button>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onClose}></div>
</div>
