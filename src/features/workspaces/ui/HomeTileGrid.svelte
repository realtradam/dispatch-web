<script lang="ts">
  import type { WorkspaceEntry } from "@dispatch/wire";
  import { nextDragPhase, type DragEvent, type DragPhase } from "../logic/drag-controller";
  import type { GridGeometry, Placement, Span } from "../logic/tile-layout";
  import { tileTone, type TileTone } from "../logic/view-model";
  import type { WorkspaceStore } from "../store.svelte";
  import WorkspaceTile from "./WorkspaceTile.svelte";

  /**
   * The Start-screen tile tones (static classes — Tailwind/DaisyUI must see
   * the literal `bg-*`/`text-*-content` names to emit them). A tile is its
   * tone's SATURATED color with the tone's `-content` text, like Win8's
   * colored tiles on the dark Start canvas.
   */
  const TONE_CLASSES: Record<TileTone, string> = {
    primary: "bg-primary text-primary-content border-primary",
    secondary: "bg-secondary text-secondary-content border-secondary",
    accent: "bg-accent text-accent-content border-accent",
    info: "bg-info text-info-content border-info",
    success: "bg-success text-success-content border-success",
    warning: "bg-warning text-warning-content border-warning",
  };

  let {
    geometry,
    placements,
    workspacesById,
    store,
    selectedId = null,
    renamingId = null,
    preview = null,
    hasActive,
    onOpen,
    onSelect,
    onReorder,
    onRenameEnd,
  }: {
    geometry: GridGeometry;
    /** Packed placements (in pack order — the manual tile order). */
    placements: readonly Placement[];
    workspacesById: ReadonlyMap<string, WorkspaceEntry>;
    /** Forwarded to tiles for the inline rename (semantics preserved). */
    store: WorkspaceStore;
    selectedId?: string | null;
    renamingId?: string | null;
    /** The resize picker's transient ghost footprint for this tile. */
    preview?: { readonly id: string; readonly colSpan: number; readonly rowSpan: number } | null;
    /** Optional port: does the workspace have an active (generating) conversation. */
    hasActive?: (workspaceId: string) => boolean;
    onOpen: (id: string) => void;
    onSelect: (id: string) => void;
    /** The drag dropped `id` at `toIndex` in the manual order (-1 = nowhere). */
    onReorder: (id: string, toIndex: number) => void;
    onRenameEnd: () => void;
  } = $props();

  // ── Drag/press state machine (pure logic, wired to pointer events) ────────
  const DRAG_THRESHOLD_PX = 6;
  const LONG_PRESS_MS = 500;
  let phase = $state<DragPhase>({ kind: "idle" });
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;

  function armLongPress(): void {
    disarmLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      dispatch({ type: "long-press" });
    }, LONG_PRESS_MS);
  }

  function disarmLongPress(): void {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }

  function dispatch(event: DragEvent): void {
    const transition = nextDragPhase(phase, event, { dragThresholdPx: DRAG_THRESHOLD_PX });
    phase = transition.phase;
    const emit = transition.emit;
    if (emit) {
      if (emit.kind === "tap") onOpen(emit.id);
      else if (emit.kind === "lift") onSelect(emit.id);
      else if (emit.kind === "drop" && emit.targetIndex >= 0) onReorder(emit.id, emit.targetIndex);
    }
    // Keep the long-press armed exactly while a TOUCH press is undecided.
    if (phase.kind === "pressing" && phase.touch) armLongPress();
    else disarmLongPress();
  }

  /** The hovered tile's index in the manual order (-1 = not over a tile). */
  function hoveredIndex(x: number, y: number): number {
    const hit = document.elementFromPoint(x, y)?.closest("[data-tile-id]");
    const id = hit?.getAttribute("data-tile-id");
    if (id === null || id === undefined) return -1;
    return placements.findIndex((placement) => placement.id === id);
  }

  /** Interactive targets inside a tile (the rename input) own their gestures. */
  function insideInteractive(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : null;
    return el?.closest("input, select, textarea, button, a") !== null;
  }

  function tilePointerDown(e: PointerEvent, id: string): void {
    if (e.button !== 0 || insideInteractive(e.target)) return;
    // Capture so fast drags keep the pointer events on this element.
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    dispatch({
      type: "pointer-down",
      id,
      x: e.clientX,
      y: e.clientY,
      touch: e.pointerType === "touch",
    });
  }

  function tilePointerMove(e: PointerEvent): void {
    if (phase.kind === "idle" || insideInteractive(e.target)) return;
    dispatch({
      type: "pointer-move",
      x: e.clientX,
      y: e.clientY,
      targetIndex: hoveredIndex(e.clientX, e.clientY),
    });
  }

  function tilePointerUp(): void {
    if (phase.kind === "idle") return;
    dispatch({ type: "pointer-up" });
  }

  // ── Tile element registry (for the FLIP reflow animation) ─────────────────
  let tileEls = new Map<string, HTMLElement>();
  let lastRects = new Map<string, { x: number; y: number }>();

  function trackTile(el: HTMLElement, id: string): { destroy: () => void } {
    tileEls.set(id, el);
    return {
      destroy() {
        tileEls.delete(id);
      },
    };
  }

  // FLIP: measure after a placements/geometry change and play the inverted
  // delta — reordering edits the ORDER, the reflow is always derived.
  $effect(() => {
    // Track the layout inputs (the DOM reads below are untracked).
    const ids = new Set(placements.map((placement) => placement.id));
    void geometry.mode;
    const rects = new Map<string, { x: number; y: number }>();
    for (const [id, el] of tileEls) {
      if (!ids.has(id)) continue;
      const rect = el.getBoundingClientRect();
      rects.set(id, { x: rect.left, y: rect.top });
    }
    for (const [id, prev] of lastRects) {
      const next = rects.get(id);
      const el = tileEls.get(id);
      if (!next || !el) continue;
      const dx = prev.x - next.x;
      const dy = prev.y - next.y;
      if ((dx !== 0 || dy !== 0) && typeof el.animate === "function") {
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { duration: 200, easing: "ease-out" },
        );
      }
    }
    lastRects = rects;
  });

  // ── Wide-mode horizontal panning: wheel + pan arrow + scroll indicator ────
  let scrollerEl = $state<HTMLDivElement | undefined>();
  let scrollProgress = $state(0);
  let canPan = $state(false);

  function updateScroll(): void {
    const el = scrollerEl;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    canPan = geometry.mode === "wide" && max > 1;
    scrollProgress = max > 0 ? el.scrollLeft / max : 0;
  }

  $effect(() => {
    // Re-measure when the geometry flips or the content first renders/changes.
    void geometry.mode;
    void placements.length;
    updateScroll();
  });

  function handleWheel(e: WheelEvent): void {
    // Vertical wheel pans the wide canvas horizontally.
    if (geometry.mode !== "wide" || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    scrollerEl?.scrollBy({ left: e.deltaY });
  }

  function pan(): void {
    const el = scrollerEl;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const atEnd = el.scrollLeft >= max - 1;
    // One viewport sideways; past the end, pan back to the start.
    el.scrollBy({ left: atEnd ? -max - el.clientWidth : el.clientWidth, behavior: "smooth" });
  }

  // ── Grid + tile styles (the geometry decides; no breakpoint classes) ──────
  const gridStyle = $derived(
    geometry.mode === "wide"
      ? `grid-template-rows: repeat(${geometry.flowRows}, ${geometry.unit.height}px);` +
          ` grid-auto-flow: column; grid-auto-columns: ${geometry.unit.width}px;` +
          ` gap: ${geometry.unit.gap}px; width: max-content;`
      : `grid-template-columns: repeat(${geometry.flowCols}, minmax(0, 1fr));` +
          ` grid-auto-flow: row; grid-auto-rows: ${geometry.unit.height}px;` +
          ` gap: ${geometry.unit.gap}px;`,
  );

  function spanFor(placement: Placement): Span {
    if (preview && preview.id === placement.id) {
      return { colSpan: preview.colSpan, rowSpan: preview.rowSpan };
    }
    return { colSpan: placement.colSpan, rowSpan: placement.rowSpan };
  }

  function wrapperStyle(placement: Placement): string {
    const span = spanFor(placement);
    return `grid-column: ${placement.col} / span ${span.colSpan}; grid-row: ${placement.row} / span ${span.rowSpan};`;
  }
</script>

<div class="relative min-h-0 flex-1">
  <div
    bind:this={scrollerEl}
    class="h-full overscroll-contain"
    class:overflow-x-auto={geometry.mode === "wide"}
    class:overflow-y-auto={geometry.mode === "tall"}
    style={`padding: ${geometry.margin}px; scroll-snap-type: ${geometry.mode === "wide" ? "x" : "y"} proximity;`}
    onscroll={updateScroll}
    onwheel={handleWheel}
  >
    <div class="grid" style={gridStyle}>
      {#each placements as placement (placement.id)}
        {@const ws = workspacesById.get(placement.id)}
        {#if ws}
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
          <div
            data-tile-id={placement.id}
            class={`flex select-none flex-col overflow-hidden rounded-box border shadow-md transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-xl ${
              TONE_CLASSES[tileTone(placement.id)]
            } ${
              selectedId === placement.id
                ? "ring-4 ring-base-content/80 ring-offset-2 ring-offset-base-100"
                : "border-transparent"
            } ${phase.kind === "dragging" && phase.id === placement.id ? "opacity-40" : ""}`}
            style={`${wrapperStyle(placement)} scroll-snap-align: start;`}
            role="button"
            tabindex="0"
            aria-label={`Open workspace ${ws.title}`}
            use:trackTile={placement.id}
            onpointerdown={(e) => tilePointerDown(e, placement.id)}
            onpointermove={tilePointerMove}
            onpointerup={tilePointerUp}
            onpointercancel={() => dispatch({ type: "cancel" })}
            oncontextmenu={(e) => {
              e.preventDefault();
              onSelect(placement.id);
            }}
            onkeydown={(e) => {
              if (insideInteractive(e.target)) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(placement.id);
              }
            }}
          >
            <WorkspaceTile
              {ws}
              {store}
              {placement}
              selected={selectedId === placement.id}
              renaming={renamingId === placement.id}
              active={hasActive?.(ws.id) ?? false}
              {onRenameEnd}
            />
          </div>
        {/if}
      {/each}
    </div>
  </div>

  {#if canPan}
    <!-- Pan arrow + thin scroll-position indicator (wide geometry only).
         Both sit INSIDE the canvas' outer margin. -->
    <button
      type="button"
      class="btn btn-circle absolute z-10 border-none bg-base-100 text-base-content shadow-xl"
      style={`right: ${Math.max(12, geometry.margin / 2)}px; bottom: ${Math.max(12, geometry.margin / 2)}px;`}
      aria-label="Pan right"
      title="Pan one screen sideways"
      onclick={pan}
    >
      →
    </button>
    <div
      class="absolute right-0 bottom-0 left-0 z-10 h-0.5 bg-base-content/10"
      style={`margin: 0 ${geometry.margin}px;`}
    >
      <div
        class="h-full bg-primary transition-[width] duration-100"
        style={`width: ${Math.round(scrollProgress * 100)}%;`}
      ></div>
    </div>
  {/if}
</div>

{#if phase.kind === "dragging"}
  <!-- The drag ghost follows the pointer (transient; never a data change). -->
  <div
    class="pointer-events-none fixed z-50 rounded-box border border-base-content/25 bg-base-100/95 px-3 py-2 text-sm font-bold shadow-2xl"
    style={`left: ${phase.x + 10}px; top: ${phase.y + 10}px;`}
  >
    {workspacesById.get(phase.id)?.title ?? phase.id}
  </div>
{/if}
