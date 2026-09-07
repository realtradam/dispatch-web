<script lang="ts">
  import type { WorkspaceEntry } from "@dispatch/wire";
  import { gsap } from "gsap";
  import { Flip } from "gsap/Flip";
  import { tick } from "svelte";
  import { nextDragPhase, type DragEvent, type DragPhase } from "../logic/drag-controller";
  import {
    displacePlace,
    dragAppendLimit,
    type Cell,
    type GridGeometry,
    type Placement,
    type Span,
  } from "../logic/tile-layout";
  import { tileTone, type TileTone } from "../logic/view-model";
  import type { WorkspaceStore } from "../store.svelte";
  import WorkspaceTile from "./WorkspaceTile.svelte";

  gsap.registerPlugin(Flip);

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
    onPlace,
    onRenameEnd,
  }: {
    geometry: GridGeometry;
    /** Packed placements of the COMMITTED layout (the drag preview derives). */
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
    /** The drag dropped `id` at `cell` (null = the pointer never resolved to a cell). */
    onPlace: (id: string, cell: Cell | null) => void;
    onRenameEnd: () => void;
  } = $props();

  // ── Drag/press state machine (pure logic, wired to pointer events) ────────
  const DRAG_THRESHOLD_PX = 6;
  const LONG_PRESS_MS = 500;
  let phase = $state<DragPhase>({ kind: "idle" });
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pointer position where the current press began (the follow transform base). */
  let pressOrigin = $state<{ x: number; y: number } | null>(null);
  /** Where within the pressed tile the pointer grabbed (its follow-transform base). */
  let grabOffset = $state<{ x: number; y: number } | null>(null);
  /** The tile mid-settle after a drop (excluded from FLIP until it lands). */
  let settling = $state<string | null>(null);

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
    const wasDragging = phase.kind === "dragging" ? phase.id : null;
    const transition = nextDragPhase(phase, event, { dragThresholdPx: DRAG_THRESHOLD_PX });
    phase = transition.phase;
    const emit = transition.emit;
    if (emit) {
      if (emit.kind === "tap") onOpen(emit.id);
      else if (emit.kind === "lift") onSelect(emit.id);
      else if (emit.kind === "drop") drop(emit.id, emit.targetCell);
    }
    if (phase.kind === "idle") {
      // The gesture ended (tap/drop/cancel). A DROP settles via `drop` above;
      // a CANCEL mid-drag flies the tile back to its committed slot.
      if (wasDragging && emit?.kind !== "drop") flyBack(wasDragging);
      pressOrigin = null;
      grabOffset = null;
    }
    // Keep the long-press armed exactly while a TOUCH press is undecided.
    if (phase.kind === "pressing" && phase.touch) armLongPress();
    else disarmLongPress();
  }

  /** The tile being dragged (or settling after a drop) follows no FLIP. */
  const excludedFromFlip = $derived(
    new Set(
      [phase.kind === "dragging" ? phase.id : null, settling].filter(
        (id): id is string => id !== null,
      ),
    ),
  );

  /** Commit the drop, then settle the tile from the pointer onto its new cell. */
  function drop(id: string, cell: Cell | null): void {
    if (cell !== null) onPlace(id, cell);
    flyBack(id);
  }

  /**
   * Animate the tile's follow transform to identity at its (possibly new)
   * committed slot — the drop settle AND the cancel/Escape fly-back. The tile
   * is excluded from Flip until the animation completes so the two never
   * fight over the same transform.
   */
  function flyBack(id: string): void {
    const el = tileEls.get(id);
    if (!el) return;
    settling = id;
    void tick().then(() => {
      gsap.to(el, {
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.2,
        ease: "power2.out",
        onComplete: () => {
          gsap.set(el, { clearProps: "transform" });
          settling = null;
        },
      });
    });
  }

  /** Interactive targets inside a tile (the rename input) own their gestures. */
  function insideInteractive(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : null;
    return el?.closest("input, select, textarea, button, a") !== null;
  }

  /**
   * Drag gestures live on the GRID CONTAINER, not the tiles: the container is
   * never re-parented, never toggles `pointer-events`, and never unmounts, so
   * pointer capture set here survives the whole gesture. (A captured element
   * whose DOM node MOVES loses its capture — the "stuck tile" bug — and an
   * uncaptured pointer can't stream events over empty cells — the empty-cell
   * bug.) Capture also keeps move/up flowing when the pointer leaves the grid.
   */
  function gridPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const tileEl = (e.target as Element | null)?.closest("[data-tile-id]");
    if (!tileEl || insideInteractive(e.target)) return;
    const id = tileEl.getAttribute("data-tile-id");
    if (id === null) return;
    gridEl?.setPointerCapture?.(e.pointerId);
    // Where within the tile the pointer grabbed — the follow transform keeps
    // THIS point under the pointer (not the tile's top-left origin).
    const rect = tileEl.getBoundingClientRect();
    grabOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    pressOrigin = { x: e.clientX, y: e.clientY };
    dispatch({
      type: "pointer-down",
      id,
      x: e.clientX,
      y: e.clientY,
      touch: e.pointerType === "touch",
    });
  }

  function gridPointerMove(e: PointerEvent): void {
    if (phase.kind === "idle") return;
    dispatch({
      type: "pointer-move",
      x: e.clientX,
      y: e.clientY,
      targetCell: cellAt(e.clientX, e.clientY),
    });
  }

  function gridPointerUp(): void {
    if (phase.kind === "idle") return;
    dispatch({ type: "pointer-up" });
  }

  // Escape mid-drag: cancel BEFORE the page-level Escape unwinds the
  // selection — the committed layout is untouched and the tile flies home.
  function windowKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || phase.kind === "idle") return;
    e.stopPropagation();
    dispatch({ type: "cancel" });
  }

  // ── Cell hit math (pointer → grid cell; empty cells are drop targets) ─────
  let gridEl = $state<HTMLDivElement | undefined>();

  const pitchX = $derived(geometry.unit.width + geometry.unit.gap);
  const pitchY = $derived(geometry.unit.height + geometry.unit.gap);

  /**
   * The drag target's clamp on the growth axis — at most 3 columns (wide) /
   * rows (tall) past the current content edge. Measured on the COMMITTED
   * placements (the drag preview never ratchets the limit mid-drag), so the
   * canvas can't endlessly grow when dragging far right / down.
   */
  const appendLimit = $derived(dragAppendLimit(placements, geometry));

  function cellAt(clientX: number, clientY: number): Cell | null {
    const el = gridEl;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const wide = geometry.mode === "wide";
    // Wide: fixed-width columns at the pitch. Tall: fluid 1fr columns.
    const cellW = wide ? pitchX : rect.width / geometry.flowCols;
    const col = Math.max(1, Math.floor((clientX - rect.left) / cellW) + 1);
    const row = Math.max(1, Math.floor((clientY - rect.top) / pitchY) + 1);
    return {
      col: wide ? Math.min(col, appendLimit) : Math.min(col, geometry.flowCols),
      row: wide ? Math.min(row, geometry.flowRows) : Math.min(row, appendLimit),
    };
  }

  // ── The drag preview: COMMITTED placements + displacement, fresh per cell ─
  /** The dragged tile's id while a drag is in flight (else null). */
  const draggedId = $derived<string | null>(
    phase.kind === "dragging" ? phase.id : null,
  );
  const draggedPlacement = $derived(
    draggedId !== null
      ? (placements.find((placement) => placement.id === draggedId) ?? null)
      : null,
  );

  /** The pointer's hovered cell while dragging (else null). */
  const hoveredCell = $derived<Cell | null>(
    phase.kind === "dragging" ? phase.targetCell : null,
  );

  /** The landing cell: where the pointer is, else the tile's committed slot. */
  const targetCell = $derived<Cell | null>(
    hoveredCell ??
      (draggedPlacement ? { col: draggedPlacement.col, row: draggedPlacement.row } : null),
  );

  /**
   * What to render: while dragging, the displacement of the COMMITTED layout
   * at the target cell — recomputed from committed on EVERY hover change (as
   * if the user moved straight from the original to here); the FLIP below
   * animates from wherever the tiles currently are. Otherwise the committed
   * placements.
   */
  const rendered = $derived(
    draggedPlacement && targetCell && draggedId !== null
      ? displacePlace(placements, draggedId, targetCell, geometry)
      : placements,
  );

  // ── FLIP reflow (GSAP Flip — re-entrant: captures mid-flight positions) ───
  let tileEls = new Map<string, HTMLElement>();

  function trackTile(el: HTMLElement, id: string): { destroy: () => void } {
    tileEls.set(id, el);
    return {
      destroy() {
        tileEls.delete(id);
      },
    };
  }

  let flipState: ReturnType<typeof Flip.getState> | null = null;

  $effect.pre(() => {
    // Track the layout inputs; the DOM read below is intentionally untracked.
    void rendered
      .map((p) => `${p.id}:${p.col},${p.row},${p.colSpan}x${p.rowSpan}`)
      .join("|");
    void geometry.mode;
    flipState = Flip.getState(
      [...tileEls].filter(([id]) => !excludedFromFlip.has(id)).map(([, el]) => el),
    );
  });

  $effect(() => {
    void rendered;
    void geometry.mode;
    const state = flipState;
    flipState = null;
    if (!state) return;
    Flip.from(state, {
      duration: 0.25,
      // Fast start, decelerating arrival — the reflow sweeps out and settles
      // into the destination (an inOut curve would ease INTO the motion too).
      ease: "power3.out",
      nested: true,
      onEnter: (elements) => gsap.fromTo(elements, { opacity: 0 }, { opacity: 1, duration: 0.2 }),
    });
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
    // Re-measure when the geometry flips, the content changes, or a drag
    // starts/ends (the reserved canvas appears then disappears).
    void geometry.mode;
    void placements.length;
    void dragging;
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
  const dragging = $derived(phase.kind === "dragging");

  /**
   * The canvas tracks reserved while dragging, on the growth axis: the append
   * limit (committed content edge + 3) PLUS the dragged tile's span room — the
   * tile may be anchored anywhere in the 3 spaces while its body stays inside
   * the reserved canvas. Computed from the COMMITTED layout at drag start, so
   * it is CONSTANT for the whole drag — the scroller never resizes mid-drag.
   */
  const reservedExtent = $derived(
    dragging && draggedPlacement
      ? dragAppendLimit(placements, geometry) +
          (geometry.mode === "wide" ? draggedPlacement.colSpan : draggedPlacement.rowSpan) -
          1
      : 0,
  );

  const gridStyle = $derived.by(() => {
    const wide = geometry.mode === "wide";
    // The grid's own size on the growth axis: `max-content` (wide) / auto
    // (tall) when idle — the canvas hugs the committed content. While DRAGGING
    // it becomes a FIXED reservation (the 3 append spaces + span room), so the
    // spaces "show up" at drag start and the scrollbar size never changes
    // until the drag ends (then the unused reservation disappears).
    const canvas = dragging
      ? wide
        ? `width: ${reservedExtent * pitchX - geometry.unit.gap}px;`
        : `height: ${reservedExtent * pitchY - geometry.unit.gap}px;`
      : wide
        ? "width: max-content;"
        : "height: auto;";
    const base =
      (wide
        ? `grid-template-rows: repeat(${geometry.flowRows}, ${geometry.unit.height}px);` +
          ` grid-auto-flow: column; grid-auto-columns: ${geometry.unit.width}px;`
        : `grid-template-columns: repeat(${geometry.flowCols}, minmax(0, 1fr));` +
          ` grid-auto-flow: row; grid-auto-rows: ${geometry.unit.height}px;`) +
      ` gap: ${geometry.unit.gap}px; ${canvas}`;
    if (!dragging) return base;
    // The drop-target dots: one faint dot at each unit cell's CENTER, painted
    // as a background whose tile is the cell pitch. The reserved canvas IS the
    // append area, so the 3 spaces (and the dragged tile's span room) get dots
    // with no extra padding.
    const dotSize = wide ? `${pitchX}px` : `calc(100% / ${geometry.flowCols})`;
    const dotX = wide ? geometry.unit.width / 2 : 0;
    const dot =
      ` background-image: radial-gradient(circle 2.5px,` +
      ` color-mix(in oklab, var(--color-base-content) 22%, transparent) 98%, transparent 100%);` +
      ` background-size: ${dotSize} ${pitchY}px;` +
      ` background-position: ${dotX}px ${geometry.unit.height / 2}px;`;
    return base + dot;
  });

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

  /**
   * The landing cell's top-left in CLIENT coordinates — where the CSS grid
   * actually places a tile anchored at `targetCell` (the true column pitch:
   * fixed in wide; the fluid column width PLUS the gap in tall). The follow
   * transform cancels exactly this, so the grab point tracks the pointer.
   */
  const targetCellOrigin = $derived.by<{ x: number; y: number } | null>(() => {
    const el = gridEl;
    if (!el || !targetCell) return null;
    const rect = el.getBoundingClientRect();
    const wide = geometry.mode === "wide";
    const colPitch = wide ? pitchX : (rect.width + geometry.unit.gap) / geometry.flowCols;
    return {
      x: rect.left + (targetCell.col - 1) * colPitch,
      y: rect.top + (targetCell.row - 1) * pitchY,
    };
  });

  /** The dragged tile's follow transform (it keeps its committed slot). */
  function followStyle(placement: Placement): string {
    if (draggedId !== placement.id || !pressOrigin || !grabOffset || phase.kind !== "dragging") {
      return "";
    }
    const origin = targetCellOrigin;
    if (!origin) return "";
    // Pointer minus the tile's GRID anchor minus the grab offset — the grab
    // point the user pressed tracks the pointer. A raw pointer-displacement
    // translate would ride the tile's origin instead and jump by the grab
    // offset (a center grab snaps the tile's top-left under the pointer).
    const dx = phase.x - origin.x - grabOffset.x;
    const dy = phase.y - origin.y - grabOffset.y;
    return `transform: translate(${dx}px, ${dy}px) scale(1.05);`;
  }

  // ── The drop ghost: a dashed footprint at the target anchor ───────────────
  const ghostStyle = $derived.by(() => {
    if (!dragging || !targetCell || !draggedPlacement) return null;
    const span = spanFor(draggedPlacement);
    const wide = geometry.mode === "wide";
    const h = span.rowSpan * pitchY - geometry.unit.gap;
    const x = wide
      ? `${(targetCell.col - 1) * pitchX}px`
      : `calc(${((targetCell.col - 1) / geometry.flowCols) * 100}%)`;
    const width = wide
      ? `${span.colSpan * pitchX - geometry.unit.gap}px`
      : `calc(${(span.colSpan / geometry.flowCols) * 100}% - ${(geometry.unit.gap * (geometry.flowCols - span.colSpan)) / geometry.flowCols}px)`;
    return `left: ${x}; top: ${(targetCell.row - 1) * pitchY}px; width: ${width}; height: ${h}px;`;
  });

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
</script>

<svelte:window onkeydowncapture={windowKeydown} />

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
    <!-- svelte-ignore a11y_no_static_element_interactions -- the grid owns the drag gestures (capture must live on a never-reparented element) -->
    <div
      bind:this={gridEl}
      class="relative grid"
      style={gridStyle}
      onpointerdown={gridPointerDown}
      onpointermove={gridPointerMove}
      onpointerup={gridPointerUp}
      onpointercancel={() => dispatch({ type: "cancel" })}
    >
      {#if ghostStyle && draggedPlacement}
        <!-- The landing footprint (the dragged tile's tone, dashed). -->
        <div
          aria-hidden="true"
          class="pointer-events-none absolute z-0 rounded-box border-2 border-dashed opacity-70"
          class:border-primary={tileTone(draggedPlacement.id) === "primary"}
          class:border-secondary={tileTone(draggedPlacement.id) === "secondary"}
          class:border-accent={tileTone(draggedPlacement.id) === "accent"}
          class:border-info={tileTone(draggedPlacement.id) === "info"}
          class:border-success={tileTone(draggedPlacement.id) === "success"}
          class:border-warning={tileTone(draggedPlacement.id) === "warning"}
          style={ghostStyle}
        ></div>
      {/if}
      {#each rendered as placement (placement.id)}
        {@const ws = workspacesById.get(placement.id)}
        {#if ws}
          {@const isDragged = draggedId === placement.id}
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
          <div
            data-tile-id={placement.id}
            class={`flex select-none flex-col overflow-hidden rounded-box border transition-[box-shadow] duration-150 ${
              TONE_CLASSES[tileTone(placement.id)]
            } ${
              selectedId === placement.id
                ? "ring-4 ring-base-content/80 ring-offset-2 ring-offset-base-100"
                : "border-transparent"
            } ${
              isDragged
                ? "pointer-events-none relative z-40 shadow-2xl"
                : "shadow-md hover:-translate-y-0.5 hover:shadow-xl"
            }`}
            style={`${wrapperStyle(placement)} ${isDragged ? followStyle(placement) : ""} scroll-snap-align: start;`}
            role="button"
            tabindex="0"
            aria-label={`Open workspace ${ws.title}`}
            use:trackTile={placement.id}
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
