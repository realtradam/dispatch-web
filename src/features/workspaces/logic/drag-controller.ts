/**
 * Pure drag/press state machine for the home tile grid — zero DOM, zero
 * timers (the component schedules the long-press timer and dispatches its
 * firing as an event), zero Svelte.
 *
 * Pointer semantics:
 * - **Mouse**: press → move past the threshold = DRAG; release without
 *   moving = a TAP (open the workspace). Selection is right-click.
 * - **Touch**: press → (no movement past the threshold) long-press = LIFT
 *   (arm the drag + select the tile) → further moves drag. Moving past the
 *   threshold BEFORE the lift cancels the press — vertical scrolling wins,
 *   so the two gestures never fight. Release while lifted = DROP.
 *
 * Pure: `(phase, event, options) → { phase, emit }`. The component owns the
 * reactive `$state` and performs the emits (navigate / select / reorder).
 */

/** Where the interaction currently stands. */
export type DragPhase =
  | { readonly kind: "idle" }
  /** Pointer is down; not yet decided between tap / drag / long-press. */
  | {
      readonly kind: "pressing";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly touch: boolean;
    }
  /** The tile is lifted and following the pointer (touch: after the long-press). */
  | {
      readonly kind: "dragging";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly targetIndex: number;
      readonly touch: boolean;
    };

/** An action the component should perform as a result of a transition. */
export type DragEmit =
  | { readonly kind: "tap"; readonly id: string }
  | { readonly kind: "lift"; readonly id: string }
  | { readonly kind: "drop"; readonly id: string; readonly targetIndex: number };

/** Events the component dispatches (DOM events + the long-press timer firing). */
export type DragEvent =
  | {
      readonly type: "pointer-down";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly touch: boolean;
    }
  | {
      readonly type: "pointer-move";
      readonly x: number;
      readonly y: number;
      readonly targetIndex: number;
    }
  | { readonly type: "pointer-up" }
  | { readonly type: "long-press" }
  /** pointercancel / blur / the tile unmounting / Escape. */
  | { readonly type: "cancel" };

export interface DragOptions {
  /** Pointer travel (px) that turns a press into a drag (or cancels a touch press). */
  readonly dragThresholdPx: number;
}

export interface DragTransition {
  readonly phase: DragPhase;
  readonly emit?: DragEmit;
}

const IDLE: DragPhase = { kind: "idle" };

/** Advance the state machine. Pure: phase + event in, NEXT phase + emit out. */
export function nextDragPhase(
  phase: DragPhase,
  event: DragEvent,
  options: DragOptions,
): DragTransition {
  switch (event.type) {
    case "pointer-down":
      // A press always restarts (a pointerdown while dragging is a new gesture).
      return {
        phase: {
          kind: "pressing",
          id: event.id,
          x: event.x,
          y: event.y,
          touch: event.touch,
        },
      };
    case "pointer-move": {
      if (phase.kind === "pressing") {
        const travelled = Math.hypot(event.x - phase.x, event.y - phase.y);
        if (travelled < options.dragThresholdPx) return { phase };
        // Touch: a big movement before the long-press lift is a SCROLL, not a
        // drag — abandon the press so the canvas scrolls natively.
        if (phase.touch) return { phase: IDLE };
        return {
          phase: {
            kind: "dragging",
            id: phase.id,
            x: event.x,
            y: event.y,
            targetIndex: event.targetIndex,
            touch: phase.touch,
          },
        };
      }
      if (phase.kind === "dragging") {
        return {
          phase: {
            ...phase,
            x: event.x,
            y: event.y,
            targetIndex: event.targetIndex,
          },
        };
      }
      return { phase };
    }
    case "pointer-up": {
      if (phase.kind === "pressing") {
        // No drag, no lift → a tap.
        return { phase: IDLE, emit: { kind: "tap", id: phase.id } };
      }
      if (phase.kind === "dragging") {
        return {
          phase: IDLE,
          emit: { kind: "drop", id: phase.id, targetIndex: phase.targetIndex },
        };
      }
      return { phase };
    }
    case "long-press": {
      if (phase.kind === "pressing" && phase.touch) {
        // Touch lift: arm the drag at the press point (the pointer will move
        // from here) + tell the component to select the tile.
        return {
          phase: {
            kind: "dragging",
            id: phase.id,
            x: phase.x,
            y: phase.y,
            targetIndex: -1,
            touch: true,
          },
          emit: { kind: "lift", id: phase.id },
        };
      }
      return { phase };
    }
    case "cancel":
      return { phase: IDLE };
  }
}
