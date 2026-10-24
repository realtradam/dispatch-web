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
  import { untrack } from "svelte";
  import { viewRegistry } from "../logic/registry";
  import { addPanelOp, firstPanelView, removePanelOp, swapPanelOp } from "../logic/panels-edit";
  import {
    initialPanelKeys,
    type PanelKeys,
    reconcilePanelKeys,
    swappedPanels,
  } from "../logic/panel-keys";
  import { markerStyle } from "../logic/marker";
  import { morphPanelHeight, panelGrowIn, panelShrinkOut } from "./panel-motion";
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

  // Stable per-panel keys (pure reconcile, memoised across tree updates) so a
  // closed panel is the one that animates out, not whichever is last.
  // A local ✕ click hints WHICH panel left (consumed by the next tree change;
  // ignored if that change isn't exactly this removal, e.g. a remote edit).
  let keyMemo: PanelKeys | null = null;
  let removeHint: number | undefined;
  const keyed = $derived.by(() => {
    const views = node.panels.map((p) => p.view);
    keyMemo =
      keyMemo === null ? initialPanelKeys(views) : reconcilePanelKeys(keyMemo, views, removeHint);
    removeHint = undefined;
    return keyMemo;
  });

  function removePanel(idx: number): void {
    removeHint = idx;
    onEdit([removePanelOp(path, idx)]);
  }

  // View SWAP: the panel BOX (the well) animates from the old view's height
  // to the new one's. Measure before the DOM updates, animate after. (Adds/removes are
  // the per-panel in:/out: transitions below.)
  let columnEl = $state<HTMLDivElement | undefined>();
  /** The keys the DOM currently shows (set after each update). */
  let shownKeys: PanelKeys | null = null;
  let before: { keys: PanelKeys; heights: Map<number, number> } | null = null;
  $effect.pre(() => {
    const next = keyed;
    untrack(() => {
      const heights = new Map<number, number>();
      for (const el of panelEls()) {
        const well = wellOf(el);
        if (well !== null) heights.set(Number(el.dataset.panelKey), well.offsetHeight);
      }
      before = { keys: shownKeys ?? next, heights };
    });
  });
  $effect(() => {
    const now = keyed;
    untrack(() => {
      const prev = before;
      before = null;
      shownKeys = now;
      if (prev === null) return;
      for (const key of swappedPanels(prev.keys, now).keys()) {
        const el = panelEls().find((e) => Number(e.dataset.panelKey) === key);
        const well = el === undefined ? null : wellOf(el);
        const from = prev.heights.get(key);
        if (well !== null && from !== undefined) morphPanelHeight(well, from);
      }
    });
  });

  function wellOf(panel: HTMLElement): HTMLElement | null {
    return panel.querySelector<HTMLElement>(":scope > [data-panel-well]");
  }

  function panelEls(): HTMLElement[] {
    return columnEl === undefined
      ? []
      : [...columnEl.querySelectorAll<HTMLElement>(":scope > [data-panel-key]")];
  }
</script>

<!-- `shrink-0`: this column is the sidebar's SCROLLED content, so it keeps its
     natural height — if it shrank to the scroller (min-h-0 in a flex column),
     its children overflowed it and the trailing margin was never scrollable. -->
<!-- No flex `gap`: each panel's wrapper carries the gap as `pb-2` instead, so
     it grows/shrinks WITH the panel's height animation (a flex gap would jump). -->
<div
  bind:this={columnEl}
  class="flex min-h-0 shrink-0 flex-col"
  style={renderMarker ? markerStyle(node.marker) : undefined}
  data-panels
>
  {#each node.panels as panel, idx (keyed.keys[idx])}
    <!-- Add/close animate the WRAPPER's height (it carries the inter-panel gap,
         so panels below slide smoothly); a view swap animates the WELL's
         height. Either way only a height is tweened (clipped) — the contents
         keep their natural size. `.inset-well` (app.css): recessed into the
         sidebar, like the chat's thinking/tool blocks. -->
    <div
      class="shrink-0 pb-2"
      data-panel-key={keyed.keys[idx]}
      in:panelGrowIn
      out:panelShrinkOut
    >
      <div class="inset-well flex flex-col p-3" data-panel-well>
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
              onclick={() => removePanel(idx)}
            >
              ✕
            </button>
          {/if}
        </div>

        <div class="mt-2">
          <TileLeaf node={panel} {ports} />
        </div>
      </div>
    </div>
  {/each}

  {#if addView !== null}
    <!-- `.raised-btn` (app.css): the mirror of the view wells above it —
         pops out where they sink in; pressed, it sinks in like them. Height =
         DaisyUI's default button size (`--size-field` × 10), as the `btn` it
         replaced; `shrink-0` so the column can never squash it. The last panel's
         `pb-2` is the gap above it; `mb-2` = the same gap below, so it
         doesn't sit tight to the end. -->
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
