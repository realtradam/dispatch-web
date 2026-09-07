# Pinned tiles + displacement reflow — plan

Feature: home tiles can be dropped onto **specific cells** of the grid; empty cells are
real estate that persists. Dragging shows a live **FLIP** reflow preview; Escape/cancel
returns everything to the committed layout.

## Interaction semantics (user-specified, literal)

The grid's cells form a fixed stream (wide: column-major over 4 rows; tall: row-major
over 2 columns). Only **filled** cells flow. Insertion at a cell pushes the contiguous
run of filled cells **forward** (in stream order) until the first empty cell absorbs it:

- `X _ X` + place Y at slot 1 → `Y X X` (X shifts into the gap; the second X never moves)
- `_ X Z _` + place Y at slot 2 → `_ Y X Z` (X and Z each shift one; leading gap kept)

Rules that follow (and are deliberately uniform):

1. **Gaps never collapse.** Removing a tile opens a gap at its anchor; nothing slides
   backward to fill it. So an internal move = remove (gap opens) + insert (run pushes
   forward): `X Y Z`, drag X to slot 3 → `_ Y X Z`. The gap at slot 1 is preserved —
   consistent with the two examples above.
2. **Preview = the exact post-drop state, recomputed from the COMMITTED layout on every
   hover-cell change** ("as if the user directly moved from the original to there" — no
   accumulation of intermediate previews). The animation, however, runs from wherever
   tiles currently are on screen (mid-flight included) to the new targets — re-entrant
   FLIP.
3. **Escape / pointercancel** discards the preview: the dragged tile flies back to its
   committed anchor and everything FLIPs home. Nothing persists.
4. During a drag: a **faint dot** marks the center of every unit cell (incl. one extra
   pitch of slack past the content end), and the **dragged tile element itself follows
   the pointer** (lifted: scale + shadow, no pointer events). A dashed ghost footprint
   marks the landing anchor.

## Data model (v2)

```ts
TileLayoutEntry { id, colSpan, rowSpan, order, col?, row? }  // col/row: pinned anchor
TileLayoutData  { version: 2, tiles }                        // sanitize migrates v1→v2
```

- Anchors are persisted in a **universal 4-row frame** (wide's frame). Tall normalizes:
  render `{ c, r }` ↔ universal `{ col: 1, row: 2(r−1)+c }`. Wide is identity.
  A pin outside tall's 2 columns reads as **unpinned** in tall (render-time clamp — same
  philosophy as spans). Round-trips can be lossy in that ragged case; accepted.
- `col`/`row` absent = **unpinned** → flows into the first free cells at render time.
- `order` remains: arrival order for unpinned flow + first-wins tie-breaks. Sort-by-recent
  now also **clears pins** (an explicit arrangement reset).
- v1 documents load as all-unpinned (render identical to today) and write back as v2 on
  the next mutation. No version sniffing outside `sanitizeLayout`.

## Pure ops (`logic/tile-layout.ts`)

- `pack(entries, geometry)` — v2: place in-range pinned tiles first (universal→render
  anchor; out-of-range/overlapping/span-unfit → deferred to unpinned), then flow unpinned
  by first-fit. One pass, no solver; first-pinned-wins, strictly one-ply (a displaced pin
  never bumps another pin).
- `displacePlace(placements, draggedId, cell, geometry)` — the render-frame core:
  remove the dragged tile (gap opens), force-anchor it at `cell`, then walk the others in
  stream order: keep if free, else re-anchor at the next fitting slot **forward** of the
  conflict (never backward). Used for BOTH the live preview (on packed placements) and,
  via `placeAtCell`, the commit.
- `placeAtCell(entries, id, cell, geometry)` — commit path: pack → displacePlace →
  pin back to entries (universal-frame anchors; persisted spans kept raw, anchors come
  from the render placements).
- `pinAtFirstEmpty(entries, id, geometry)` — the create flow: pin the tile at the first
  truly-empty slot (holes now count).
- `firstEmptySlot` — unchanged contract, now hole-aware by construction.
- `sortByRecentActivity` — renumbers order AND clears pins.

## Store (`tile-layout-store.svelte.ts`)

- `move(id, toIndex)` → replaced by `placeAtCell(id, cell, geometry)`.
- Structural equality (`sameEntries`) gains `col`/`row`.

## Drag (`logic/drag-controller.ts`)

- `targetIndex: number` → `targetCell: { col, row } | null` (pure rename; semantics of
  the state machine — tap/lift/drop/cancel, touch scroll-wins — unchanged).

## Component (`HomeTileGrid.svelte`)

- **Hit math** replaces `elementFromPoint`: cell = `floor((pointer − gridRect.origin) /
  pitch) + 1` (pitch = unit + gap), clamped to ≥ 1 and to the fixed cross-axis. The gap
  between cells maps to the preceding cell. The pointer always resolves to a cell during
  a drag (clamped), so empty cells are drop targets.
- **Dots overlay**: while dragging, the grid gets a `radial-gradient` background
  (2px dot, `base-content` at low opacity) with `background-size = pitch × pitch` and
  `background-position = unit/2` so dots sit at cell centers; `padding` extends one pitch
  past the content end so the append-slot has a dot. Pure CSS, no extra DOM.
- **Dragged tile follows the pointer**: the wrapper keeps its committed grid slot in the
  layout; a `translate(pointer − grabOffset) scale(1.05)` transform (via gsap) lifts it
  out visually; `pointer-events: none` + pointer capture keep the events flowing.
- **Ghost**: dashed outline (dragged tile's tone) at the preview anchor, footprint-sized.
- **FLIP**: GSAP `Flip` plugin. Capture in `$effect.pre` (state of all tile elements
  except the dragged/settling one), mutate (preview placements / committed placements),
  `Flip.from(state, …)` in `$effect` after the DOM update. Re-entrancy comes free:
  `Flip.getState` records in-flight transforms, so each hover change animates from the
  current visual position — while the preview itself is always recomputed from COMMITTED
  (semantics vs. motion stay separate, per the user's requirement).
- **Drop**: commit `placeAtCell`, then settle the tile from its pointer transform to
  identity (gsap, ~150ms) — it lands exactly where the ghost was.
- **Escape**: window `keydown` in the CAPTURE phase while dragging (beats the page-level
  Escape→deselect handler, `stopPropagation`): dispatch `cancel` → preview discards →
  tiles FLIP home → dragged tile gsap-animates from the pointer back to its anchor.

## Out of scope / non-goals

- No backward displacement (runs only push forward); no multi-tile drag; no touch
  auto-scroll while dragging (existing scroll-wins semantics stay).
- The resize picker is unchanged: resizing a pinned tile may push it to unpinned flow if
  the footprint no longer fits its anchor (render-time rule — persisted spans untouched).

## Files

1. `src/features/workspaces/logic/tile-layout.ts` (+ `tile-layout.test.ts`) — the bulk
2. `src/features/workspaces/tile-layout-store.svelte.ts` (+ test)
3. `src/features/workspaces/logic/drag-controller.ts` (+ test) — mechanical targetCell rename
4. `src/features/workspaces/ui/HomeTileGrid.svelte` — hit math, dots, follow-pointer, ghost, Flip
5. `src/features/workspaces/ui/WorkspacesHome.svelte` (+ test) — wire placeAtCell; sort label
6. `src/features/workspaces/ui/HomeHeader.svelte` — sort label copy

## Verification

- New pure tests: v2 sanitize/migration, pinned pack (incl. wide↔tall mapping, overlap
  first-wins, out-of-range → flow), displacement (both user examples + internal moves +
  span cases), pin round-trip, hole-aware firstEmptySlot, store equality.
- Component tests: Escape cancels a drag without persisting; drop commits `placeAtCell`.
- `bun run typecheck && bun run test && bun run build`; biome clean on touched files.
- Headless screenshots (wide + tall) of a pinned layout with gaps.
