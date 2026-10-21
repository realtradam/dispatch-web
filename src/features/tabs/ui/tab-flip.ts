import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { isGroupFlipId, leavingFlipIds } from "../tab-flip";

gsap.registerPlugin(Flip);

/**
 * GSAP Flip animation for the tab grid — the DOM EFFECT half of the tab
 * FLIP (the pure id scheme lives in `../tab-flip.ts`).
 *
 * Driven by the owning component in two calls:
 *  - `capture(nextIds)` — BEFORE the DOM updates: record every `[data-flip-id]`
 *    element's position (First), and spawn an inert GHOST for each element the
 *    next render drops (a closed tab / dissolved group box).
 *  - `play()` — AFTER the DOM updates: run three STAGGERED phases, each only
 *    when it has something to do —
 *      1. SHRINK — ghosts collapse to 0 height (everything else holds still);
 *      2. MOVE   — surviving elements Flip from their old box to their new
 *                  one (Last → Invert → Play);
 *      3. GROW   — new cards (and new group boxes' tints) grow from 0 height.
 *
 * Like the sidebar panels (`layout/ui/panel-motion.ts`), shrink/grow change
 * only a HEIGHT, clipped — the contents keep their natural size and are
 * revealed / hidden from the bottom edge, never scaled or faded. Grow is a
 * `clip-path` reveal so the grid's layout (already settled by MOVE) never
 * shifts under it.
 *
 * Data-driven, not click-driven: it animates ANY change to the tab set (a
 * summoned subagent, a close from another device, a regroup). Re-entrant —
 * `Flip.getState` captures mid-flight positions. Disabled when the user
 * prefers reduced motion (or the environment can't tell, e.g. jsdom).
 */
export interface TabFlip {
  capture(nextIds: ReadonlySet<string>): void;
  play(): void;
}

const SHRINK = 0.1;
const MOVE = 0.15;
const GROW = 0.1;
const SIZE_EASE = "power2.inOut";
const MOVE_EASE = "power3.out";
const GHOST_ATTR = "data-tab-ghost";
/** Fully clipped from the bottom edge up / fully revealed. */
const CLIP_HIDDEN = "inset(0% 0% 100% 0%)";
const CLIP_SHOWN = "inset(0% 0% 0% 0%)";

interface Captured {
  readonly state: ReturnType<typeof Flip.getState>;
  readonly rects: ReadonlyMap<string, DOMRect>;
  readonly ghosted: boolean;
}

export function createTabFlip(getScroller: () => HTMLElement | undefined): TabFlip {
  let captured: Captured | null = null;

  return {
    capture(nextIds) {
      captured = null;
      const scroller = getScroller();
      if (scroller === undefined || !motionAllowed()) return;
      const els = flipElements(scroller);
      if (els.length === 0) return;
      const rects = new Map(els.map((el) => [el.dataset.flipId ?? "", el.getBoundingClientRect()]));
      const byId = new Map(els.map((el) => [el.dataset.flipId ?? "", el]));
      let ghosted = false;
      for (const id of leavingFlipIds([...byId.keys()], nextIds)) {
        const el = byId.get(id);
        if (el !== undefined) ghosted = spawnGhost(scroller, el, isGroupFlipId(id)) || ghosted;
      }
      captured = { state: Flip.getState(els), rects, ghosted };
    },

    play() {
      const prev = captured;
      captured = null;
      const scroller = getScroller();
      if (prev === null || scroller === undefined) return;

      const els = flipElements(scroller);
      const staying = els.filter((el) => prev.rects.has(el.dataset.flipId ?? ""));
      const entering = els.filter((el) => !prev.rects.has(el.dataset.flipId ?? ""));
      const moved = staying.some((el) => {
        const before = prev.rects.get(el.dataset.flipId ?? "");
        return before !== undefined && !sameBox(before, el.getBoundingClientRect());
      });

      // Phase timing: skip a phase that has nothing to animate.
      const moveAt = prev.ghosted ? SHRINK : 0;
      const growAt = moveAt + (moved ? MOVE : 0);

      // 3. GROW — hide new elements NOW (through shrink + move), reveal later.
      for (const el of entering) {
        const target = isGroupFlipId(el.dataset.flipId ?? "")
          ? el.querySelector<HTMLElement>(":scope > [data-group-backdrop]") // tint only
          : el;
        if (target === null) continue;
        gsap.killTweensOf(target, "clipPath");
        gsap.fromTo(
          target,
          { clipPath: CLIP_HIDDEN },
          {
            clipPath: CLIP_SHOWN,
            duration: GROW,
            delay: growAt,
            ease: SIZE_EASE,
            clearProps: "clipPath",
          },
        );
      }

      // 2. MOVE — Flip holds survivors at their old boxes until `moveAt`.
      if (moved) {
        Flip.from(prev.state, {
          targets: staying,
          duration: MOVE,
          delay: moveAt,
          ease: MOVE_EASE,
          nested: true,
        });
      }
    },
  };
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

function motionAllowed(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function flipElements(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>("[data-flip-id]")];
}

/**
 * An inert visual copy of a leaving element, absolutely positioned over its
 * last on-screen rect, that SHRINKS to 0 height (phase 1) and removes itself.
 * The ghost is a clipping frame around a full-size copy, so only the frame's
 * height animates — the copy inside never resizes or reflows.
 *
 * Paint order matters (cards are `relative`, so everything here stacks in DOM
 * order): a leaving CARD's ghost is appended to the scroller so it shrinks
 * ON TOP of the grid. A leaving GROUP BOX copies only its backdrop (the
 * tint — its cards either flip elsewhere or ghost themselves) and is inserted
 * as the FIRST child of the box's enclosing grid: above the enclosing box's
 * own tint, but BELOW every card, so the dissolving tint never covers them.
 *
 * Returns whether a ghost was spawned.
 */
function spawnGhost(scroller: HTMLElement, el: HTMLElement, isGroup: boolean): boolean {
  const source = isGroup ? el.querySelector<HTMLElement>(":scope > [data-group-backdrop]") : el;
  if (source === null) return false;
  const host = isGroup ? el.parentElement : scroller;
  if (host === null) return false;
  const r = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const copy = source.cloneNode(!isGroup) as HTMLElement;
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
  // The copy keeps the element's full size for the whole animation.
  Object.assign(copy.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${r.width}px`,
    height: `${r.height}px`,
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
    left: `${r.left - h.left - host.clientLeft + host.scrollLeft}px`,
    top: `${r.top - h.top - host.clientTop + host.scrollTop}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: isGroup ? "auto" : "2",
  });
  ghost.appendChild(copy);
  if (isGroup) host.prepend(ghost);
  else host.appendChild(ghost);
  gsap.to(ghost, {
    height: 0,
    duration: SHRINK,
    ease: SIZE_EASE,
    onComplete: () => ghost.remove(),
  });
  return true;
}
