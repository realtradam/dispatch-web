<script lang="ts">
  /**
   * A scrolling stack of swappable panels — the generalized ViewSidebar. The
   * panel list comes from the tree node; dropdown options from the (reactive)
   * registry's panel-eligible views. Edits emit tree ops upward via `onEdit`;
   * the OWNER (App today, the backend store in plan 02) applies them and
   * decides persistence.
   */
  import type { LayoutOp, PanelsNode, Path } from "@dispatch/layout-contract";
  import PlusIcon from "phosphor-svelte/lib/PlusIcon";
  import { viewRegistry } from "../logic/registry";
  import { addPanelOp, firstPanelView, removePanelOp, swapPanelOp } from "../logic/panels-edit";
  import { markerStyle } from "../logic/marker";
  import TileLeaf from "./TileLeaf.svelte";

  let {
    node,
    path,
    ports,
    onEdit,
    renderMarker = false,
  }: {
    node: PanelsNode;
    path: Path;
    ports?: unknown;
    onEdit: (ops: readonly LayoutOp[]) => void;
    /**
     * Whether to draw the node's diagnostic marker on this root. Default NO:
     * a panels node is the scrolled CONTENT of a split's collapsible child,
     * so an outline here wraps the full scrollable region and scrolls with
     * it — the split draws the marker on the aside (the fixed viewport)
     * instead. Pass `true` only for a panels node used outside a split.
     */
    renderMarker?: boolean;
  } = $props();

  // Panel-eligible views only (decision 5): chat/composer/message-queue never
  // appear in the dropdowns. Reactive so late registrations re-render options.
  const panelViews = $derived($viewRegistry.filter((v) => v.panelEligible));
  const addView = $derived(firstPanelView(panelViews));
</script>

<!-- `shrink-0`: this column is the sidebar's SCROLLED content, so it keeps its
     natural height — if it shrank to the scroller (min-h-0 in a flex column),
     its children overflowed it and the trailing margin was never scrollable. -->
<div
  class="flex min-h-0 shrink-0 flex-col gap-2"
  style={renderMarker ? markerStyle(node.marker) : undefined}
>
  {#each node.panels as panel, idx (idx)}
    <!-- `.inset-well` (app.css): recessed into the sidebar, like the chat's
         thinking/tool blocks. -->
    <div class="inset-well flex flex-col p-3">
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
    <!-- `.raised-btn` (app.css): the mirror of the view wells above it —
         pops out where they sink in; pressed, it sinks in like them. Height =
         DaisyUI's default button size (`--size-field` × 10), as the `btn` it
         replaced; `shrink-0` so the column can never squash it. `mb-2` = the
         gap between views (`gap-2`), so it doesn't sit tight to the end. -->
    <button
      type="button"
      class="raised-btn mb-2 h-[calc(var(--size-field,0.25rem)*10)] w-full shrink-0"
      aria-label="Add view"
      onclick={() => addView !== null && onEdit([addPanelOp(path, addView)])}
    >
      <PlusIcon size={18} weight="bold" aria-hidden="true" />
    </button>
  {/if}
</div>
