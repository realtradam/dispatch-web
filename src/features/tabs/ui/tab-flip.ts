import { gsap } from "gsap";
import { isGroupFlipId, leavingFlipIds } from "../tab-flip";

/**
 * FLIP animation for the tab grid — the DOM EFFECT half (the pure id scheme
 * lives in `../tab-flip.ts`).
 *
 * Driven by the owning component in two calls:
 *  - `capture(nextIds)` — BEFORE the DOM updates: measure every
 *    `[data-flip-id]` element (First), and build an inert GHOST for each
 *    element the next render drops (a closed tab / dissolved group box).
 *  - `play()` — AFTER the DOM updates: measure again (Last), then run three
 *    STAGGERED phases, each only when it has something to do —
 *      1. SHRINK — ghosts collapse to 0 height (everything else holds still);
 *      2. MOVE   — cards slide from their old box to their new one, and each
 *                  group box's tint morphs from its old rect to its new one;
 *      3. GROW   — new cards (and new group boxes' tints) grow from 0 height.
 *
 * PERFORMANCE: this is a hand-rolled FLIP, not GSAP's Flip plugin. Flip
 * recorded computed styles per element and re-measured while building its
 * timeline — ~430ms of main-thread work per close with ~40 nested tabs, which
 * both delayed the click and swallowed the shrink phase. Here each change
 * costs exactly two batched layout reads (one in `capture`, one in `play`);
 * every write happens after its batch of reads. Each phase is ONE GSAP tween
 * on a plain progress value whose `onUpdate` writes inline styles directly —
 * GSAP never reads an element's computed style (per-element CSS tweens did,
 * forcing a style recalc per moved card). Cards only TRANSLATE (plus a
 * width tween when a card turns into / out of a double-width group parent);
 * a group box never moves itself — only its absolutely-positioned, empty tint
 * layer does (inset tween), so no card is ever double-translated.
 *
 * Like the sidebar panels (`layout/ui/panel-motion.ts`), shrink/grow change
 * only a HEIGHT, clipped — contents keep their natural size. Grow is a
 * `clip-path` reveal so the settled grid never shifts under it.
 *
 * Data-driven, not click-driven: it animates ANY change to the tab set (a
 * summoned subagent, a close from another device, a regroup). Re-entrant —
 * `capture` measures the in-flight VISUAL boxes, `play` clears in-flight
 * motion before measuring the new layout. Disabled when the user prefers
 * reduced motion (or the environment can't tell, e.g. jsdom).
 */
export interface TabFlip {
  capture(nextIds: ReadonlySet<string>): void;
  play(): void;
}

const SHRINK = 0.1;
const MOVE = 0.1;
const GROW = 0.1;
/** Close: starts slow, finishes fast (accelerates away). */
const SHRINK_EASE = "power2.in";
/** Move: slow → fast → slow. */
const MOVE_EASE = "power2.inOut";
/** Open: starts fast, settles slowly (the mirror of close). */
const GROW_EASE = "power2.out";
const GHOST_ATTR = "data-tab-ghost";
/** Fully clipped from the bottom edge up (0 visible height). */
const CLIP_HIDDEN = "inset(0% 0% 100% 0%)";
/** Every inline style this module may leave on a live element mid-flight. */
const MOTION_PROPS = ["transform", "width", "clip-path", "top", "right", "bottom", "left"];

interface Captured {
  /** Visual box (incl. any in-flight motion) per flip id. Cards: the card; boxes: the tint. */
  readonly rects: ReadonlyMap<string, DOMRect>;
  /** Built but not yet started — their shrink starts in `play`. */
  readonly ghosts: readonly HTMLElement[];
}

export function createTabFlip(getScroller: () => HTMLElement | undefined): TabFlip {
  let captured: Captured | null = null;
  /** Live elements carrying motion styles, so `play` can reset exactly those. */
  const animating = new Set<HTMLElement>();
  /** The running MOVE + GROW phase tweens (ghost shrinks run independently). */
  let phases: gsap.core.Tween[] = [];

  return {
    capture(nextIds) {
      captured = null;
      const scroller = getScroller();
      if (scroller === undefined || !motionAllowed()) return;
      const els = flipElements(scroller);
      if (els.length === 0) return;

      // READS (one layout).
      const rects = new Map<string, DOMRect>();
      for (const el of els) rects.set(idOf(el), measureTarget(el).getBoundingClientRect());
      const leaving = leavingFlipIds([...rects.keys()], nextIds);
      const byId = new Map(els.map((el) => [idOf(el), el]));
      const plans = leaving
        .map((id) => byId.get(id))
        .filter((el): el is HTMLElement => el !== undefined)
        .map((el) => planGhost(scroller, el, rects.get(idOf(el))))
        .filter((p): p is GhostPlan => p !== null);

      // WRITES.
      captured = { rects, ghosts: plans.map(insertGhost) };
    },

    play() {
      const prev = captured;
      captured = null;
      const scroller = getScroller();
      if (prev === null || scroller === undefined) return;

      // Reset in-flight motion on live elements so the read below is the
      // settled layout (their previous VISUAL boxes are already in `prev`).
      for (const tween of phases) tween.kill();
      phases = [];
      for (const el of animating) clearMotion(el);
      animating.clear();

      // READS (one layout).
      const next = flipElements(scroller).map((el) => {
        const target = measureTarget(el);
        return { target, id: idOf(el), rect: target.getBoundingClientRect() };
      });

      // Plan (pure arithmetic — no DOM access).
      const entering: HTMLElement[] = [];
      const movers: Mover[] = [];
      for (const { target, id, rect } of next) {
        const before = prev.rects.get(id);
        if (before === undefined) entering.push(target);
        else if (!sameBox(before, rect))
          movers.push(planMove(target, isGroupFlipId(id), before, rect));
      }
      const moveAt = prev.ghosts.length > 0 ? SHRINK : 0;
      const growAt = moveAt + (movers.length > 0 ? MOVE : 0);

      // WRITES — first frame of every phase NOW (movers hold at their old
      // boxes, new elements are fully clipped) so nothing flashes in between.
      for (const m of movers) m.render(0);
      for (const el of entering) el.style.clipPath = CLIP_HIDDEN;

      // 1. SHRINK — one tween drives every ghost.
      if (prev.ghosts.length > 0) {
        const ghosts = prev.ghosts.map((g) => ({ g, h: Number.parseFloat(g.style.height) }));
        gsap.to(
          { p: 0 },
          {
            p: 1,
            duration: SHRINK,
            ease: SHRINK_EASE,
            onUpdate(this: gsap.core.Tween) {
              const p = this.targets<{ p: number }>()[0]?.p ?? 1;
              for (const { g, h } of ghosts) g.style.height = `${h * (1 - p)}px`;
            },
            onComplete: () => {
              for (const { g } of ghosts) g.remove();
            },
          },
        );
      }

      // 2. MOVE — one tween drives every card slide + tint morph.
      if (movers.length > 0) {
        for (const m of movers) animating.add(m.el);
        phases.push(
          gsap.to(
            { p: 0 },
            {
              p: 1,
              duration: MOVE,
              delay: moveAt,
              ease: MOVE_EASE,
              onUpdate(this: gsap.core.Tween) {
                const p = this.targets<{ p: number }>()[0]?.p ?? 1;
                for (const m of movers) m.render(p);
              },
              onComplete: () => {
                for (const m of movers) {
                  clearMotion(m.el);
                  animating.delete(m.el);
                }
              },
            },
          ),
        );
      }

      // 3. GROW — one tween reveals every new card / tint from its top edge.
      if (entering.length > 0) {
        for (const el of entering) animating.add(el);
        phases.push(
          gsap.to(
            { p: 0 },
            {
              p: 1,
              duration: GROW,
              delay: growAt,
              ease: GROW_EASE,
              onUpdate(this: gsap.core.Tween) {
                const p = this.targets<{ p: number }>()[0]?.p ?? 1;
                const clip = `inset(0% 0% ${(1 - p) * 100}% 0%)`;
                for (const el of entering) el.style.clipPath = clip;
              },
              onComplete: () => {
                for (const el of entering) {
                  clearMotion(el);
                  animating.delete(el);
                }
              },
            },
          ),
        );
      }
    },
  };
}

interface Mover {
  readonly el: HTMLElement;
  /** Write the element's styles at move progress `p` (0 = old box, 1 = home). */
  render(p: number): void;
}

/**
 * A card slides (and, when it turned into / out of a double-width group
 * parent, resizes) from its old box; a group tint morphs its insets from its
 * old rect. Both end at their natural layout (`p = 1` ⇒ zero offsets).
 */
function planMove(el: HTMLElement, isTint: boolean, from: DOMRect, to: DOMRect): Mover {
  if (isTint) {
    const top = from.top - to.top;
    const left = from.left - to.left;
    const right = to.right - from.right;
    const bottom = to.bottom - from.bottom;
    return {
      el,
      render(p) {
        const k = 1 - p;
        el.style.top = `${top * k}px`;
        el.style.left = `${left * k}px`;
        el.style.right = `${right * k}px`;
        el.style.bottom = `${bottom * k}px`;
      },
    };
  }
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const resized = Math.abs(from.width - to.width) >= 0.5;
  return {
    el,
    render(p) {
      const k = 1 - p;
      el.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      if (resized) el.style.width = `${to.width + (from.width - to.width) * k}px`;
    },
  };
}

function clearMotion(el: HTMLElement): void {
  for (const prop of MOTION_PROPS) el.style.removeProperty(prop);
}

function motionAllowed(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function flipElements(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>("[data-flip-id]")];
}

function idOf(el: HTMLElement): string {
  return el.dataset.flipId ?? "";
}

/** What VISUALLY represents a flip element: a card itself, a group box's tint. */
function measureTarget(el: HTMLElement): HTMLElement {
  if (!isGroupFlipId(idOf(el))) return el;
  return el.querySelector<HTMLElement>(":scope > [data-group-backdrop]") ?? el;
}

/** Whether two rects are the same box (sub-pixel tolerance). */
function sameBox(a: DOMRect, b: DOMRect): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 0.5;
  return (
    close(a.left, b.left) &&
    close(a.top, b.top) &&
    close(a.width, b.width) &&
    close(a.height, b.height)
  );
}

interface GhostPlan {
  readonly source: HTMLElement;
  readonly host: HTMLElement;
  readonly isGroup: boolean;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * READ half of a ghost: where an inert copy of a leaving element must sit.
 *
 * Paint order matters (cards are `relative`, so everything here stacks in DOM
 * order): a leaving CARD's ghost goes on the scroller, ON TOP of the grid. A
 * leaving GROUP BOX copies only its tint and goes FIRST in the box's
 * enclosing grid: above the enclosing box's own tint, but BELOW every card.
 */
function planGhost(
  scroller: HTMLElement,
  el: HTMLElement,
  rect: DOMRect | undefined,
): GhostPlan | null {
  const isGroup = isGroupFlipId(idOf(el));
  const source = measureTarget(el);
  const host = isGroup ? el.parentElement : scroller;
  if (host === null || rect === undefined || (isGroup && source === el)) return null;
  const h = host.getBoundingClientRect();
  return {
    source,
    host,
    isGroup,
    left: rect.left - h.left - host.clientLeft + host.scrollLeft,
    top: rect.top - h.top - host.clientTop + host.scrollTop,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * WRITE half of a ghost: a clipping frame (whose height later shrinks to 0)
 * around a full-size copy — only the frame animates, the copy never resizes.
 */
function insertGhost(plan: GhostPlan): HTMLElement {
  const copy = plan.source.cloneNode(!plan.isGroup) as HTMLElement;
  // A ghost is never a tab/group to queries, tests or assistive tech.
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    for (const attr of [
      "data-flip-id",
      "data-conversation-id",
      "data-group-backdrop",
      "role",
      "id",
    ]) {
      node.removeAttribute(attr);
    }
  }
  Object.assign(copy.style, {
    position: "absolute",
    inset: "auto",
    left: "0",
    top: "0",
    width: `${plan.width}px`,
    height: `${plan.height}px`,
    margin: "0",
    transform: "none",
    clipPath: "none",
  });
  const ghost = document.createElement("div");
  ghost.setAttribute(GHOST_ATTR, "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${plan.left}px`,
    top: `${plan.top}px`,
    width: `${plan.width}px`,
    height: `${plan.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: plan.isGroup ? "auto" : "2",
  });
  ghost.appendChild(copy);
  if (plan.isGroup) plan.host.prepend(ghost);
  else plan.host.appendChild(ghost);
  return ghost;
}
