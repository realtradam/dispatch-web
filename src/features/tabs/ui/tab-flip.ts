import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { isGroupFlipId, leavingFlipIds } from "../tab-flip";

gsap.registerPlugin(Flip);

/**
 * GSAP Flip animation for the tab grid — the DOM EFFECT half of the tab
 * FLIP (the pure id scheme lives in `../tab-flip.ts`).
 *
 * Two-phase, driven by the owning component:
 *  - `capture(nextIds)` — BEFORE the DOM updates: record every `[data-flip-id]`
 *    element's position (First), and spawn an inert GHOST for each element the
 *    next render drops, so a closed tab / dissolved group box fades out in
 *    place instead of vanishing.
 *  - `play()` — AFTER the DOM updates: Flip every surviving element from its
 *    recorded position to its new one (Last → Invert → Play), scale new cards
 *    in, and fade new group boxes' backdrops in.
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

const DURATION = 0.4;
const GHOST_ATTR = "data-tab-ghost";

export function createTabFlip(getScroller: () => HTMLElement | undefined): TabFlip {
  let state: ReturnType<typeof Flip.getState> | null = null;

  return {
    capture(nextIds) {
      state = null;
      const scroller = getScroller();
      if (scroller === undefined || !motionAllowed()) return;
      const els = flipElements(scroller);
      if (els.length === 0) return;
      state = Flip.getState(els);
      const byId = new Map(els.map((el) => [el.dataset.flipId ?? "", el]));
      for (const id of leavingFlipIds([...byId.keys()], nextIds)) {
        const el = byId.get(id);
        if (el !== undefined) spawnGhost(scroller, el, isGroupFlipId(id));
      }
    },

    play() {
      const captured = state;
      state = null;
      const scroller = getScroller();
      if (captured === null || scroller === undefined) return;
      Flip.from(captured, {
        targets: flipElements(scroller),
        duration: DURATION,
        ease: "power3.out",
        nested: true,
        onEnter: (elements) => {
          for (const el of elements) {
            if (!(el instanceof HTMLElement)) continue;
            if (isGroupFlipId(el.dataset.flipId ?? "")) {
              // The box's CARDS are flipping into place — fade only its tint.
              const backdrop = el.querySelector<HTMLElement>(":scope > [data-group-backdrop]");
              if (backdrop !== null) {
                gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: DURATION });
              }
            } else {
              gsap.fromTo(
                el,
                { opacity: 0, scale: 0.6 },
                {
                  opacity: 1,
                  scale: 1,
                  duration: DURATION,
                  delay: DURATION * 0.35, // let the grid open the gap first
                  ease: "back.out(1.7)",
                  clearProps: "opacity,transform",
                },
              );
            }
          }
        },
      });
    },
  };
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
 * last on-screen rect, that shrinks + fades out and removes itself.
 *
 * Paint order matters (cards are `relative`, so everything here stacks in DOM
 * order): a leaving CARD's ghost is appended to the scroller so it fades out
 * ON TOP of the reflow. A leaving GROUP BOX copies only its backdrop (the
 * tint — its cards either flip elsewhere or ghost themselves) and is inserted
 * as the FIRST child of the box's enclosing grid: above the enclosing box's
 * own tint, but BELOW every card, so the dissolving tint never dims the cards
 * flying out of it.
 */
function spawnGhost(scroller: HTMLElement, el: HTMLElement, isGroup: boolean): void {
  const source = isGroup ? el.querySelector<HTMLElement>(":scope > [data-group-backdrop]") : el;
  if (source === null) return;
  const host = isGroup ? el.parentElement : scroller;
  if (host === null) return;
  const r = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const ghost = source.cloneNode(!isGroup) as HTMLElement;
  // A ghost is never a tab/group to queries, tests or assistive tech.
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
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
  ghost.setAttribute(GHOST_ATTR, "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${r.left - h.left - host.clientLeft + host.scrollLeft}px`,
    top: `${r.top - h.top - host.clientTop + host.scrollTop}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: "0",
    transform: "none",
    pointerEvents: "none",
    zIndex: isGroup ? "auto" : "2",
  });
  if (isGroup) host.prepend(ghost);
  else host.appendChild(ghost);
  gsap.to(ghost, {
    opacity: 0,
    scale: isGroup ? 1 : 0.6,
    duration: DURATION * 0.75,
    ease: "power2.in",
    onComplete: () => ghost.remove(),
  });
}
