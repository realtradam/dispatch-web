import { gsap } from "gsap";
import type { TransitionConfig } from "svelte/transition";

/**
 * GSAP height animations for sidebar panels — the DOM EFFECT half (stable
 * panel identity lives in `../logic/panel-keys.ts`).
 *
 * Every animation changes ONLY the panel wrapper's height (clipped with
 * `overflow: hidden`); the panel's contents keep their natural size the whole
 * time — the wrapper reveals / hides them like a drawer, it never scales
 * them. The wrapper's bottom padding is the gap between panels, so it grows /
 * shrinks with the panel and the panels below slide smoothly.
 *
 *  - `panelGrowIn`  — Svelte `in:` transition: an added panel grows 0 → auto.
 *  - `panelShrinkOut` — Svelte `out:` transition: a closed panel shrinks to 0
 *    while staying in flow (Svelte keeps the node for the returned duration).
 *  - `morphPanelHeight` — a swapped view: the panel BOX (the well, so its
 *    edges move with it — no empty gap below a shrinking box) animates from
 *    the old view's height to the new one's.
 *
 * Svelte's `in:` does not run on first mount, so loading the page never
 * animates. Disabled when the user prefers reduced motion (or the
 * environment can't tell, e.g. jsdom) — then every change is instant.
 */

const DURATION = 0.35;
const EASE = "power2.inOut";

export function panelMotionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function panelGrowIn(node: HTMLElement): TransitionConfig {
  if (!panelMotionAllowed()) return { duration: 0 };
  gsap.killTweensOf(node);
  gsap.fromTo(
    node,
    { height: 0, overflow: "hidden" },
    {
      height: "auto",
      duration: DURATION,
      ease: EASE,
      clearProps: "height,overflow",
    },
  );
  return { duration: DURATION * 1000 };
}

export function panelShrinkOut(node: HTMLElement): TransitionConfig {
  if (!panelMotionAllowed()) return { duration: 0 };
  // e.g. closed mid-grow / mid-swap: shrink from wherever it is.
  gsap.killTweensOf([node, ...node.querySelectorAll(":scope > *")]);
  gsap.to(node, {
    height: 0,
    overflow: "hidden",
    duration: DURATION,
    ease: EASE,
  });
  return { duration: DURATION * 1000 };
}

/**
 * Animate `node` from `fromHeight` (its height before the view swapped) to
 * its new natural height. Call AFTER the DOM shows the new view.
 */
export function morphPanelHeight(node: HTMLElement, fromHeight: number): void {
  if (!panelMotionAllowed()) return;
  gsap.killTweensOf(node);
  gsap.fromTo(
    node,
    { height: fromHeight, overflow: "hidden" },
    {
      height: "auto",
      duration: DURATION,
      ease: EASE,
      clearProps: "height,overflow",
    },
  );
}
