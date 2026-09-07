<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { GridGeometry, Span } from "../logic/tile-layout";

  let {
    geometry,
    initial,
    onPreview,
    onCommit,
    onCancel,
  }: {
    geometry: GridGeometry;
    /** The tile's current (clamped) spans — the picker's starting cell. */
    initial: Span;
    /** Transiently ghost-preview the hovered footprint on the real grid. */
    onPreview: (span: Span | null) => void;
    onCommit: (colSpan: number, rowSpan: number) => void;
    onCancel: () => void;
  } = $props();

  // The picker IS the span cap: wide = 4×2 small squares, tall = 2×2.
  const cols = $derived(geometry.maxColSpan);
  const rows = $derived(geometry.maxRowSpan);

  // The currently hovered cell (c, r) — the highlighted rectangle spans
  // 1..c × 1..r from the picker's top-left (insert-table style). The picker
  // mounts fresh per resize session, so seeding from the prop is intended.
  let hovered = $state({
    colSpan: untrack(() => Math.min(initial.colSpan, cols)),
    rowSpan: untrack(() => Math.min(initial.rowSpan, rows)),
  });

  function hover(colSpan: number, rowSpan: number): void {
    hovered = { colSpan, rowSpan };
    onPreview({ colSpan, rowSpan });
  }

  function commit(): void {
    onCommit(hovered.colSpan, hovered.rowSpan);
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    let dc = 0;
    let dr = 0;
    if (e.key === "ArrowRight") dc = 1;
    else if (e.key === "ArrowLeft") dc = -1;
    else if (e.key === "ArrowDown") dr = 1;
    else if (e.key === "ArrowUp") dr = -1;
    else return;
    e.preventDefault();
    hover(
      Math.max(1, Math.min(cols, hovered.colSpan + dc)),
      Math.max(1, Math.min(rows, hovered.rowSpan + dr)),
    );
  }

  let root = $state<HTMLDivElement | undefined>();
  onMount(() => root?.focus());
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div
  bind:this={root}
  class="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-max flex-col gap-2 rounded-box border border-base-content/20 bg-base-100 p-3 shadow-2xl outline-none"
  role="group"
  aria-label="Resize tile"
  tabindex="0"
  onkeydown={keydown}
  onmouseleave={() => onPreview(null)}
>
  <p class="text-xs font-semibold uppercase opacity-60">Resize — click a size</p>
  <div class="grid gap-1" style={`grid-template-columns: repeat(${cols}, 1.5rem);`}>
    {#each Array.from({ length: rows }) as _, row (row)}
      {#each Array.from({ length: cols }) as __, col (col)}
        <button
          type="button"
          class={`size-6 border border-base-content/20 ${
            col < hovered.colSpan && row < hovered.rowSpan
              ? "bg-primary/60"
              : col === hovered.colSpan - 1 && row === hovered.rowSpan - 1
                ? "bg-primary/20"
                : ""
          }`}
          aria-label={`Resize to ${col + 1} by ${row + 1}`}
          onmouseenter={() => hover(col + 1, row + 1)}
          onfocus={() => hover(col + 1, row + 1)}
          onclick={() => {
            hover(col + 1, row + 1);
            commit();
          }}
        ></button>
      {/each}
    {/each}
  </div>
  <p class="text-center font-mono text-xs opacity-70">{hovered.colSpan} × {hovered.rowSpan}</p>
  <p class="text-center text-[10px] opacity-50">Enter commits · Escape cancels</p>
</div>
