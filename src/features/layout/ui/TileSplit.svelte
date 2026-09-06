<script lang="ts">
  /**
   * A flex row/column of child subtrees. Child sizing comes from the tree:
   * `size` → flex-grow (+ optional `basis`), and `collapsible` children get
   * today's EXACT sidebar behavior — width/translate transition, `lg:relative`
   * in-flow push vs `max-lg:absolute` overlay with a backdrop. Collapse state
   * is chrome (per-node-id), owned by the injected collapse store.
   */
  import type { LayoutOp, Path, SplitNode, TileMarker } from "@dispatch/layout-contract";
  import type { CollapseStore } from "../logic/collapse";
  import { markerStyle } from "../logic/marker";
  import TileNode from "./TileNode.svelte";

  let {
    node,
    path,
    ports,
    collapse,
    onEdit,
  }: {
    node: SplitNode;
    path: Path;
    ports?: unknown;
    collapse: CollapseStore;
    onEdit: (ops: readonly LayoutOp[]) => void;
  } = $props();

  const state = $derived($collapse);

  /** Collapse state key: the node's id when present, else its path (stable enough for chrome). */
  function keyOf(i: number, id: string | undefined): string {
    return id ?? [...path, i].map((s) => String(s)).join(":");
  }

  function isOpen(i: number, id: string | undefined): boolean {
    const key = keyOf(i, id);
    return state.openByNode[key] ?? state.defaultOpen;
  }

  /**
   * The scroll container's inline style: the fixed sidebar width + slide
   * transform + any diagnostic marker (inset) — none when unmarked.
   *
   * The marker goes on THIS div, not the aside: the inner div paints an
   * OPAQUE full-height background (bg-base-100) that would cover an outline
   * drawn on the aside. This div's own box never moves — only its contents
   * scroll — and overflow-y-auto clips descendants, never an element's own
   * outline, so the marker frames exactly the visible sidebar.
   */
  function scrollViewportStyle(
    basis: number | undefined,
    open: boolean,
    marker: TileMarker | undefined,
  ): string {
    const parts = [`width: ${basis ?? 320}px`, `transform: translateX(${open ? "0" : "100%"})`];
    const markerCss = markerStyle(marker);
    if (markerCss !== undefined) parts.push(markerCss);
    return parts.join("; ");
  }
</script>

{#if node.dir === "col"}
  <div class="flex min-h-0 w-full flex-col" style={markerStyle(node.marker)}>
    {#each node.children as child, i (i)}
      {@const key = keyOf(i, child.node.id)}
      <div
        class="min-h-0 min-w-0"
        style={"flex: " + child.size + " 1 " + (child.basis === undefined ? "0%" : child.basis + "px")}
      >
        <TileNode node={child.node} path={[...path, i]} {ports} {collapse} {onEdit} />
      </div>
    {/each}
  </div>
{:else}
  <div class="flex min-h-0 h-full flex-row" style={markerStyle(node.marker)}>
    {#each node.children as child, i (i)}
      {@const key = keyOf(i, child.node.id)}
      {#if child.collapsible}
        {@const open = isOpen(i, child.node.id)}
        <!--
          A diagnostic marker on a collapsible child is drawn on the SCROLL
          CONTAINER below — the sidebar's fixed, opaquely-painted viewport —
          NOT on the child's own root element: that root renders INSIDE the
          scroll container, so an outline there would wrap the full
          scrollable content and scroll along with it instead of framing the
          visible panel.
        -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <aside
          class="flex shrink-0 flex-col overflow-x-hidden transition-[width] duration-300 ease-out max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 lg:relative"
          style="width: {open ? (child.basis ?? 320) : 0}px"
          data-testid="collapsible-child"
          data-open={open}
        >
          <div
            class="flex h-full flex-col gap-2 overflow-y-auto bg-base-100 pt-3 pr-3 pb-3 transition-transform duration-300 ease-out"
            style={scrollViewportStyle(child.basis, open, child.node.marker)}
            data-testid="sidebar-scroll-viewport"
          >
            <TileNode node={child.node} path={[...path, i]} {ports} {collapse} {onEdit} />
          </div>
        </aside>
        {#if open}
          <!-- Backdrop: only on narrow screens (overlay mode), click to close. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-20 bg-black/30 lg:hidden"
            role="button"
            tabindex="0"
            aria-label="Close sidebar"
            onclick={() => collapse.setOpen(key, false)}
            onkeydown={(e) => {
              if (e.key === "Escape" || e.key === "Enter") collapse.setOpen(key, false);
            }}
          ></div>
        {/if}
      {:else}
        <div
          class="min-h-0 min-w-0"
          style={"flex: " + child.size + " 1 " + (child.basis === undefined ? "0%" : child.basis + "px")}
        >
          <TileNode node={child.node} path={[...path, i]} {ports} {collapse} {onEdit} />
        </div>
      {/if}
    {/each}
  </div>
{/if}
