import { describe, expect, it } from "vitest";
import { type DragPhase, type DragTransition, nextDragPhase } from "./drag-controller";

const OPTS = { dragThresholdPx: 6 };

function down(over: Partial<Parameters<typeof nextDragPhase>[1] & { type: "pointer-down" }> = {}) {
  return {
    type: "pointer-down" as const,
    id: "t1",
    x: 10,
    y: 10,
    touch: false,
    ...over,
  };
}

function press(touch = false): DragPhase {
  return nextDragPhase({ kind: "idle" }, down({ touch }), OPTS).phase;
}

describe("nextDragPhase — mouse", () => {
  it("a pointer-down enters the undecided pressing state", () => {
    expect(press()).toEqual({ kind: "pressing", id: "t1", x: 10, y: 10, touch: false });
  });

  it("movement past the threshold starts a drag", () => {
    const transition = nextDragPhase(
      press(),
      { type: "pointer-move", x: 20, y: 12, targetIndex: 3 },
      OPTS,
    );
    expect(transition.phase).toEqual({
      kind: "dragging",
      id: "t1",
      x: 20,
      y: 12,
      targetIndex: 3,
      touch: false,
    });
    expect(transition.emit).toBeUndefined();
  });

  it("movement within the threshold stays pressing", () => {
    const transition = nextDragPhase(
      press(),
      { type: "pointer-move", x: 12, y: 14, targetIndex: 0 },
      OPTS,
    );
    expect(transition.phase).toEqual({ kind: "pressing", id: "t1", x: 10, y: 10, touch: false });
  });

  it("release without moving emits a tap (open the workspace)", () => {
    const transition = nextDragPhase(press(), { type: "pointer-up" }, OPTS);
    expect(transition.phase).toEqual({ kind: "idle" });
    expect(transition.emit).toEqual({ kind: "tap", id: "t1" });
  });

  it("release while dragging emits a drop with the last tracked index", () => {
    let transition: DragTransition = nextDragPhase(
      press(),
      { type: "pointer-move", x: 30, y: 30, targetIndex: 2 },
      OPTS,
    );
    transition = nextDragPhase(
      transition.phase,
      { type: "pointer-move", x: 31, y: 31, targetIndex: 5 },
      OPTS,
    );
    transition = nextDragPhase(transition.phase, { type: "pointer-up" }, OPTS);
    expect(transition.emit).toEqual({ kind: "drop", id: "t1", targetIndex: 5 });
    expect(transition.phase).toEqual({ kind: "idle" });
  });
});

describe("nextDragPhase — touch", () => {
  it("a long-press lifts the tile and emits lift (arm the drag + select)", () => {
    const transition = nextDragPhase(press(true), { type: "long-press" }, OPTS);
    expect(transition.emit).toEqual({ kind: "lift", id: "t1" });
    expect(transition.phase).toEqual({
      kind: "dragging",
      id: "t1",
      x: 10,
      y: 10,
      targetIndex: -1,
      touch: true,
    });
  });

  it("movement past the threshold BEFORE the lift cancels (vertical scrolling wins)", () => {
    const transition = nextDragPhase(
      press(true),
      { type: "pointer-move", x: 10, y: 80, targetIndex: 0 },
      OPTS,
    );
    expect(transition.phase).toEqual({ kind: "idle" });
    expect(transition.emit).toBeUndefined();
  });

  it("movement within the threshold before the lift keeps pressing", () => {
    const transition = nextDragPhase(
      press(true),
      { type: "pointer-move", x: 13, y: 12, targetIndex: 0 },
      OPTS,
    );
    expect(transition.phase?.kind).toBe("pressing");
  });

  it("after the lift, movement drags (never cancels)", () => {
    let transition = nextDragPhase(press(true), { type: "long-press" }, OPTS);
    transition = nextDragPhase(
      transition.phase,
      { type: "pointer-move", x: 10, y: 90, targetIndex: 4 },
      OPTS,
    );
    expect(transition.phase).toEqual({
      kind: "dragging",
      id: "t1",
      x: 10,
      y: 90,
      targetIndex: 4,
      touch: true,
    });
  });

  it("a long-press never lifts a mouse press (desktop selects via right-click)", () => {
    const transition = nextDragPhase(press(false), { type: "long-press" }, OPTS);
    expect(transition.emit).toBeUndefined();
    expect(transition.phase?.kind).toBe("pressing");
  });

  it("release while lifted (no movement) drops at the lifted tile's own slot", () => {
    let transition = nextDragPhase(press(true), { type: "long-press" }, OPTS);
    transition = nextDragPhase(transition.phase, { type: "pointer-up" }, OPTS);
    expect(transition.emit).toEqual({ kind: "drop", id: "t1", targetIndex: -1 });
  });
});

describe("nextDragPhase — cancellations", () => {
  it("cancel returns to idle from any phase without emitting", () => {
    for (const phase of [
      { kind: "idle" as const },
      press(),
      nextDragPhase(press(), { type: "pointer-move", x: 40, y: 40, targetIndex: 1 }, OPTS).phase,
    ]) {
      const transition = nextDragPhase(phase, { type: "cancel" }, OPTS);
      expect(transition.phase).toEqual({ kind: "idle" });
      expect(transition.emit).toBeUndefined();
    }
  });

  it("events in idle are inert", () => {
    expect(nextDragPhase({ kind: "idle" }, { type: "pointer-up" }, OPTS).phase).toEqual({
      kind: "idle",
    });
    expect(
      nextDragPhase({ kind: "idle" }, { type: "pointer-move", x: 1, y: 1, targetIndex: 0 }, OPTS)
        .phase,
    ).toEqual({ kind: "idle" });
    expect(nextDragPhase({ kind: "idle" }, { type: "long-press" }, OPTS).phase).toEqual({
      kind: "idle",
    });
  });

  it("a second pointer-down restarts the gesture with the new tile", () => {
    const dragging = nextDragPhase(
      press(),
      { type: "pointer-move", x: 40, y: 40, targetIndex: 1 },
      OPTS,
    ).phase;
    const transition = nextDragPhase(dragging, down({ id: "t2" }), OPTS);
    expect(transition.phase).toEqual({ kind: "pressing", id: "t2", x: 10, y: 10, touch: false });
  });
});
