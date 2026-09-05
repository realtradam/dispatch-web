<script lang="ts">
  /**
   * A scrolling stack of swappable panels — the generalized ViewSidebar. The
   * panel list comes from the tree node; dropdown options from the (reactive)
   * registry's panel-eligible views. Edits emit tree ops upward via `onEdit`;
   * the OWNER (App today, the backend store in plan 02) applies them and
   * decides persistence.
   */
  import type { LayoutOp, PanelsNode, Path } from "@dispatch/layout-contract";
  import { viewRegistry } from "../logic/registry";
  import { addPanelOp, firstPanelView, removePanelOp, swapPanelOp } from "../logic/panels-edit";
  import { markerOutline } from "../logic/marker";
  import TileLeaf from "./TileLeaf.svelte";

  let {
    node,
    path,
    ports,
    onEdit,
  }: {
    node: PanelsNode;
    path: Path;
    ports?: unknown;
    onEdit: (ops: readonly LayoutOp[]) => void;
  } = $props();

  // Panel-eligible views only (decision 5): chat/composer/message-queue never
  // appear in the dropdowns. Reactive so late registrations re-render options.
  const panelViews = $derived($viewRegistry.filter((v) => v.panelEligible));
  const addView = $derived(firstPanelView(panelViews));
</script>

<div class="flex min-h-0 flex-col gap-2" style:outline={markerOutline(node.marker)}>
  {#each node.panels as panel, idx (idx)}
    <div class="flex flex-col rounded-lg bg-base-200 p-3">
      <div class="flex items-center gap-1">
        <select
          class="select select-bordered select-sm flex-1"
          aria-label="Select a view"
          value={panel.view}
          onchange={(e) => onEdit([swapPanelOp(path, idx, e.currentTarget.value)])}
        >
          <option value="" disabled>Select a view</option>
          {#each panelViews as view (view.id)}
            <option value={view.id}>{view.label}</option>
          {/each}
        </select>
        {#if idx > 0}
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm shrink-0"
            aria-label="Remove view"
            onclick={() => onEdit([removePanelOp(path, idx)])}
          >
            ✕
          </button>
        {/if}
      </div>

      <div class="mt-2">
        <TileLeaf node={panel} {ports} />
      </div>
    </div>
  {/each}

  {#if addView !== null}
    <button
      type="button"
      class="btn w-full border-none bg-base-200 text-lg hover:bg-base-300"
      aria-label="Add view"
      onclick={() => addView !== null && onEdit([addPanelOp(path, addView)])}
    >
      +
    </button>
  {/if}
</div>
