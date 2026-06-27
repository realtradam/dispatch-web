import type { StepId, TurnDoneEvent, TurnStepCompleteEvent, TurnUsageEvent } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
  applyDurableMetrics,
  foldMetricsEvent,
  initialMetricsState,
  selectCurrentContextSize,
  selectOrderedTurnMetrics,
} from "./reducer";

const usageEvent = (
  turnId: string,
  inputTokens: number,
  outputTokens: number,
  stepId?: string,
): TurnUsageEvent => {
  const base = {
    type: "usage" as const,
    conversationId: "c1",
    turnId,
    usage: { inputTokens, outputTokens },
  };
  if (stepId !== undefined) {
    return { ...base, stepId: stepId as StepId };
  }
  return base;
};

const stepCompleteEvent = (
  turnId: string,
  stepId: string,
  timing: { ttftMs?: number; decodeMs?: number; genTotalMs?: number } = {},
): TurnStepCompleteEvent => ({
  type: "step-complete",
  conversationId: "c1",
  turnId,
  stepId: stepId as StepId,
  ...timing,
});

const doneEvent = (
  turnId: string,
  extra: {
    durationMs?: number;
    usage?: { inputTokens: number; outputTokens: number };
    contextSize?: number;
  } = {},
): TurnDoneEvent => ({
  type: "done",
  conversationId: "c1",
  turnId,
  reason: "stop",
  ...extra,
});

describe("initialMetricsState", () => {
  it("starts empty", () => {
    const s = initialMetricsState();
    expect(s.live.size).toBe(0);
    expect(s.liveOrder).toEqual([]);
    expect(s.durable.size).toBe(0);
    expect(s.durableOrder).toEqual([]);
  });
});

describe("foldMetricsEvent", () => {
  it("folds per-step usage by stepId into a turn", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.turnId).toBe("t1");
    expect(ordered[0]?.steps).toHaveLength(2);
    expect(ordered[0]?.steps[0]?.stepId).toBe("s1");
    expect(ordered[0]?.steps[0]?.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(ordered[0]?.steps[1]?.stepId).toBe("s2");
    expect(ordered[0]?.steps[1]?.usage).toEqual({ inputTokens: 200, outputTokens: 80 });
  });

  it("folds step-complete timing and merges with same-step usage", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(
      s,
      stepCompleteEvent("t1", "s1", { ttftMs: 200, decodeMs: 800, genTotalMs: 1000 }),
    );
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(1);
    const step = ordered[0]?.steps[0];
    expect(step?.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(step?.ttftMs).toBe(200);
    expect(step?.decodeMs).toBe(800);
    expect(step?.genTotalMs).toBe(1000);
  });

  it("step-complete before usage defaults usage to zeros", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1", { genTotalMs: 500 }));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    const step = ordered[0]?.steps[0];
    expect(step?.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(step?.genTotalMs).toBe(500);
  });

  it("done sets durationMs and aggregate usage", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(
      s,
      doneEvent("t1", {
        durationMs: 5000,
        usage: { inputTokens: 300, outputTokens: 150 },
      }),
    );

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.total?.durationMs).toBe(5000);
    expect(ordered[0]?.total?.usage).toEqual({ inputTokens: 300, outputTokens: 150 });
  });

  it("aggregate usage sums steps when done.usage absent", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.total?.usage).toEqual({ inputTokens: 300, outputTokens: 130 });
  });

  it("aggregate usage includes cache only when a step had cache", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, {
      type: "usage",
      conversationId: "c1",
      turnId: "t1",
      stepId: "s1" as StepId,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 30 },
    });
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.total?.usage.cacheReadTokens).toBe(30);
    expect(ordered[0]?.total?.usage.cacheWriteTokens).toBeUndefined();
  });

  it("tolerates missing clock (no genTotalMs/ttft/decode)", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    const step = ordered[0]?.steps[0];
    expect(step?.ttftMs).toBeUndefined();
    expect(step?.decodeMs).toBeUndefined();
    expect(step?.genTotalMs).toBeUndefined();
    expect(ordered[0]?.total?.durationMs).toBeUndefined();
  });

  it("usage without stepId does not create a turn", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(0);
  });

  it("ignores non-metrics events", () => {
    const s = initialMetricsState();
    const next = foldMetricsEvent(s, {
      type: "status",
      conversationId: "c1",
      status: "running",
    });
    expect(next).toBe(s);
  });

  it("preserves first-seen order of steps", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 10, 5, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    s = foldMetricsEvent(s, usageEvent("t1", 20, 8, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.steps[0]?.stepId).toBe("s2");
    expect(ordered[0]?.steps[1]?.stepId).toBe("s1");
  });

  it("preserves first-seen order of turns", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t2", 10, 5, "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 20, 8, "s1"));
    s = foldMetricsEvent(s, doneEvent("t2"));
    s = foldMetricsEvent(s, doneEvent("t1"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.turnId).toBe("t2");
    expect(ordered[1]?.turnId).toBe("t1");
  });
});

describe("selectOrderedTurnMetrics", () => {
  it("durable wins over live by turnId, live-done appended last", () => {
    let s = initialMetricsState();

    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, usageEvent("t2", 200, 80, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1"));
    s = foldMetricsEvent(s, doneEvent("t2"));

    s = applyDurableMetrics(s, [
      {
        turnId: "t1",
        usage: { inputTokens: 999, outputTokens: 999 },
        durationMs: 3000,
        steps: [
          {
            stepId: "s1" as StepId,
            usage: { inputTokens: 999, outputTokens: 999 },
            genTotalMs: 3000,
          },
        ],
      },
    ]);

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(2);
    expect(ordered[0]?.turnId).toBe("t1");
    expect(ordered[0]?.total?.usage.inputTokens).toBe(999);
    expect(ordered[0]?.total?.durationMs).toBe(3000);
    expect(ordered[1]?.turnId).toBe("t2");
    expect(ordered[1]?.total?.durationMs).toBeUndefined();
  });

  it("empty state returns empty", () => {
    const s = initialMetricsState();
    expect(selectOrderedTurnMetrics(s)).toEqual([]);
  });

  it("selectOrderedTurnMetrics: in-flight turn exposes only completed steps and total=null", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1", { genTotalMs: 1000 }));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.turnId).toBe("t1");
    expect(ordered[0]?.steps).toHaveLength(1);
    expect(ordered[0]?.steps[0]?.stepId).toBe("s1");
    expect(ordered[0]?.total).toBeNull();
  });

  it("selectOrderedTurnMetrics: a turn with no complete step and not done is omitted", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(0);
  });

  it("selectOrderedTurnMetrics: after done, total is present", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1", { genTotalMs: 1000 }));
    s = foldMetricsEvent(s, doneEvent("t1", { durationMs: 2000 }));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.turnId).toBe("t1");
    expect(ordered[0]?.total?.durationMs).toBe(2000);
    expect(ordered[0]?.steps).toHaveLength(1);
  });

  it("step-complete marks the step complete", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1", { genTotalMs: 500 }));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.steps).toHaveLength(1);
    expect(ordered[0]?.steps[0]?.stepId).toBe("s1");
    expect(ordered[0]?.steps[0]?.genTotalMs).toBe(500);
  });

  it("selectOrderedTurnMetrics: durable turn → steps + total present", () => {
    let s = initialMetricsState();
    s = applyDurableMetrics(s, [
      {
        turnId: "t1",
        usage: { inputTokens: 300, outputTokens: 150 },
        durationMs: 5000,
        steps: [
          {
            stepId: "s1" as StepId,
            usage: { inputTokens: 100, outputTokens: 50 },
            genTotalMs: 1000,
          },
          {
            stepId: "s2" as StepId,
            usage: { inputTokens: 200, outputTokens: 100 },
            genTotalMs: 2000,
          },
        ],
      },
    ]);

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.turnId).toBe("t1");
    expect(ordered[0]?.steps).toHaveLength(2);
    expect(ordered[0]?.steps[0]?.stepId).toBe("s1");
    expect(ordered[0]?.steps[1]?.stepId).toBe("s2");
    expect(ordered[0]?.total?.usage.inputTokens).toBe(300);
    expect(ordered[0]?.total?.durationMs).toBe(5000);
  });
});

describe("applyDurableMetrics", () => {
  it("stores durable turns in order", () => {
    let s = initialMetricsState();
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 10, outputTokens: 5 }, steps: [] },
      { turnId: "t2", usage: { inputTokens: 20, outputTokens: 8 }, steps: [] },
    ]);
    expect(s.durableOrder).toEqual(["t1", "t2"]);
    expect(s.durable.size).toBe(2);
  });

  it("is idempotent for same turnId", () => {
    let s = initialMetricsState();
    const turn = {
      turnId: "t1",
      usage: { inputTokens: 10, outputTokens: 5 },
      steps: [],
    };
    s = applyDurableMetrics(s, [turn]);
    s = applyDurableMetrics(s, [turn]);
    expect(s.durableOrder).toEqual(["t1"]);
    expect(s.durable.size).toBe(1);
  });

  it("overwrites durable turn data for same turnId", () => {
    let s = initialMetricsState();
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 10, outputTokens: 5 }, steps: [] },
    ]);
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 99, outputTokens: 99 }, steps: [] },
    ]);
    expect(s.durable.get("t1")?.usage.inputTokens).toBe(99);
  });
});

describe("contextSize / selectCurrentContextSize", () => {
  it("live done carries contextSize onto the turn total", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 1234 }));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.total?.contextSize).toBe(1234);
    expect(selectCurrentContextSize(s)).toBe(1234);
  });

  it("contextSize is NOT the aggregate usage sum (multi-step turn)", () => {
    let s = initialMetricsState();
    // Two steps: usage sums to 300 in / 130 out = 430, but contextSize is the
    // backend-stamped final-step occupancy, independent of the sum.
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 250 }));

    const ordered = selectOrderedTurnMetrics(s);
    expect(ordered[0]?.total?.usage).toEqual({ inputTokens: 300, outputTokens: 130 });
    expect(ordered[0]?.total?.contextSize).toBe(250);
    expect(selectCurrentContextSize(s)).toBe(250);
  });

  it("persisted (durable) contextSize is preserved and selected", () => {
    let s = initialMetricsState();
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 10, outputTokens: 5 }, steps: [], contextSize: 4096 },
    ]);
    expect(s.durable.get("t1")?.contextSize).toBe(4096);
    expect(selectCurrentContextSize(s)).toBe(4096);
  });

  it("selectCurrentContextSize returns the LATEST turn's value", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 100 }));
    s = foldMetricsEvent(s, doneEvent("t2", { contextSize: 900 }));
    expect(selectCurrentContextSize(s)).toBe(900);
  });

  it("selectCurrentContextSize skips a later turn that lacks contextSize", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 700 }));
    // t2 finishes but the provider reported no per-step usage → no contextSize.
    s = foldMetricsEvent(s, doneEvent("t2"));
    expect(selectCurrentContextSize(s)).toBe(700);
  });

  it("selectCurrentContextSize is undefined (not 0) when nothing reported", () => {
    let s = initialMetricsState();
    expect(selectCurrentContextSize(s)).toBeUndefined();
    s = foldMetricsEvent(s, doneEvent("t1"));
    expect(selectCurrentContextSize(s)).toBeUndefined();
  });

  it("durable contextSize wins over live for a shared turnId", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 111 }));
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 1, outputTokens: 1 }, steps: [], contextSize: 222 },
    ]);
    expect(selectCurrentContextSize(s)).toBe(222);
  });

  it("in-flight turn updates context size after the first step completes", () => {
    // Before the requirement: an in-flight turn had total=null so its step usage
    // was ignored until `done`. Now the latest step's input+output is used.
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 5000, 200, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));

    // Still generating (no done) — context = step 1 input+output = 5200.
    expect(selectCurrentContextSize(s)).toBe(5200);
  });

  it("in-flight turn updates progressively as each step reports usage", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 5000, 200, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    expect(selectCurrentContextSize(s)).toBe(5200);

    // Step 2 reports usage mid-stream (before its step-complete): each step's
    // input already includes all prior context, so the last step's input+output
    // is the current occupancy.
    s = foldMetricsEvent(s, usageEvent("t1", 5200, 150, "s2"));
    expect(selectCurrentContextSize(s)).toBe(5350);

    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    expect(selectCurrentContextSize(s)).toBe(5350);
  });

  it("in-flight context size is the latest step with usage, NOT the aggregate sum", () => {
    // Mirrors the finalized-turn test: contextSize is the FINAL step's
    // input+output, not the sum across steps (which would overcount a
    // multi-step turn because every step re-prefills the growing prompt).
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 200, 80, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    // Aggregate would be 300+130=430; the latest step is 200+80=280.
    expect(selectCurrentContextSize(s)).toBe(280);
  });

  it("in-flight turn with a step-complete but no usage falls back to older turn", () => {
    // step-complete before usage → the step has no usage yet, so the in-flight
    // turn exposes no context size and the display falls back to the prior
    // finalized turn's value (never 0).
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 700 }));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1", { genTotalMs: 500 }));

    expect(selectCurrentContextSize(s)).toBe(700);
  });

  it("in-flight turn with no steps/usage returns undefined (falls back)", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 700 }));
    // t2 just started — no usage, no complete step — omitted entirely.
    s = foldMetricsEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t2" });
    expect(selectCurrentContextSize(s)).toBe(700);

    // t2's first step reports usage → the display jumps to t2's live value.
    s = foldMetricsEvent(s, usageEvent("t2", 800, 10, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1"));
    expect(selectCurrentContextSize(s)).toBe(810);
  });

  it("done finalizes the in-flight progressive value with the authoritative contextSize", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 5000, 200, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    expect(selectCurrentContextSize(s)).toBe(5200);

    s = foldMetricsEvent(s, usageEvent("t1", 5200, 150, "s2"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    expect(selectCurrentContextSize(s)).toBe(5350);

    // done stamps the authoritative contextSize (the final step's input+output).
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 5350 }));
    expect(selectCurrentContextSize(s)).toBe(5350);
  });

  it("in-flight context size excludes cache tokens (they are a subset of inputTokens)", () => {
    // cacheReadTokens / cacheWriteTokens are portions of inputTokens already
    // counted — adding them would double-count. Only input+output is occupancy.
    let s = initialMetricsState();
    s = foldMetricsEvent(s, {
      type: "usage",
      conversationId: "c1",
      turnId: "t1",
      stepId: "s1" as StepId,
      usage: {
        inputTokens: 5000,
        outputTokens: 200,
        cacheReadTokens: 4000,
        cacheWriteTokens: 1000,
      },
    });
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    // 5000+200=5200, NOT 9200 (with cacheRead) or 10200 (with both).
    expect(selectCurrentContextSize(s)).toBe(5200);
  });

  it("multiple in-flight turns: the newest turn's live value wins", () => {
    let s = initialMetricsState();
    // t1 (older) in-flight with one completed step → 5200.
    s = foldMetricsEvent(s, usageEvent("t1", 5000, 200, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    // t2 (newer, seen later → last in liveOrder) in-flight → 8000.
    s = foldMetricsEvent(s, usageEvent("t2", 7800, 200, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1"));
    expect(selectCurrentContextSize(s)).toBe(8000);
  });

  it("out-of-order step IDs: usage for step 2 before step 1's step-complete still scans newest-first", () => {
    // stepOrder is FIRST-SEEN: s1 (its usage arrived first), then s2. So s2 is
    // the newest step regardless of when each step's step-complete arrives.
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 5000, 200, "s1"));
    s = foldMetricsEvent(s, usageEvent("t1", 5200, 150, "s2"));
    // Neither step complete yet → the turn is omitted (no complete step), so the
    // display can't update until the first step completes.
    expect(selectCurrentContextSize(s)).toBeUndefined();

    // s1 completes AFTER s2's usage was reported. The turn is now visible; the
    // newest-first scan picks s2 (the later step), not s1 (the just-completed one).
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    expect(selectCurrentContextSize(s)).toBe(5350);

    // s2 completes — still s2, unchanged.
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    expect(selectCurrentContextSize(s)).toBe(5350);
  });

  it("done turn without contextSize falls back to an older turn (even with step usage)", () => {
    // Contract lock-in: a done turn's step usage is NOT consulted for the
    // context display — only its authoritative total.contextSize is. When that
    // is absent, the display falls back to the next older finalized turn rather
    // than synthesizing a value from the step usage.
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 700 }));
    // t2 done WITH step usage but NO done.contextSize (edge case: the done event
    // omitted contextSize despite per-step usage).
    s = foldMetricsEvent(s, usageEvent("t2", 800, 10, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1"));
    s = foldMetricsEvent(s, doneEvent("t2"));
    expect(selectCurrentContextSize(s)).toBe(700);
  });

  it("in-flight context size skips a step with unsafe usage (NaN / negative)", () => {
    // A corrupt provider report must never reach the status bar. The newest
    // step with invalid counters is skipped, falling back to the prior valid one.
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 5000, 200, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    // s2 reports NaN input (e.g. a non-numeric provider field coerced).
    s = foldMetricsEvent(s, {
      type: "usage",
      conversationId: "c1",
      turnId: "t1",
      stepId: "s2" as StepId,
      usage: { inputTokens: Number.NaN, outputTokens: 150 },
    });
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s2"));
    // s2 skipped (NaN) → falls back to s1's 5200, NOT NaN.
    expect(selectCurrentContextSize(s)).toBe(5200);

    // Negative tokens are likewise skipped.
    s = foldMetricsEvent(s, {
      type: "usage",
      conversationId: "c1",
      turnId: "t1",
      stepId: "s3" as StepId,
      usage: { inputTokens: -10, outputTokens: 5 },
    });
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s3"));
    expect(selectCurrentContextSize(s)).toBe(5200);
  });
});

describe("applyDurableMetrics pruning", () => {
  it("prunes a live turn once durable data covers it (no unbounded growth)", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 150 }));
    expect(s.live.has("t1")).toBe(true);
    expect(s.liveOrder).toContain("t1");

    s = applyDurableMetrics(s, [
      {
        turnId: "t1",
        usage: { inputTokens: 100, outputTokens: 50 },
        steps: [{ stepId: "s1" as StepId, usage: { inputTokens: 100, outputTokens: 50 } }],
        contextSize: 150,
      },
    ]);
    // The live copy is gone; the durable (authoritative) entry replaces it.
    expect(s.live.has("t1")).toBe(false);
    expect(s.liveOrder).not.toContain("t1");
    expect(s.durable.has("t1")).toBe(true);
    // The display still reads the durable value atomically (no gap).
    expect(selectCurrentContextSize(s)).toBe(150);
  });

  it("prunes only the turns present in the durable batch (leaves other live turns)", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t1", 100, 50, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t1", "s1"));
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 150 }));
    // t2 still in flight — must NOT be pruned when only t1 seals.
    s = foldMetricsEvent(s, usageEvent("t2", 800, 10, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1"));

    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 100, outputTokens: 50 }, steps: [], contextSize: 150 },
    ]);
    expect(s.live.has("t1")).toBe(false);
    expect(s.live.has("t2")).toBe(true);
    expect(s.liveOrder).toEqual(["t2"]);
    // The newest (in-flight) turn's live value still wins.
    expect(selectCurrentContextSize(s)).toBe(810);
  });

  it("is a no-op when no incoming turn is live (no live mutation)", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, usageEvent("t2", 800, 10, "s1"));
    s = foldMetricsEvent(s, stepCompleteEvent("t2", "s1"));
    const before = s;
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 1, outputTokens: 1 }, steps: [] },
    ]);
    // t1 was never live → the live map/order are unchanged (same reference).
    expect(s.live).toBe(before.live);
    expect(s.liveOrder).toBe(before.liveOrder);
    // t1 (durable) is older; the in-flight t2 still wins.
    expect(selectCurrentContextSize(s)).toBe(810);
  });

  it("durable wins over live for a shared turnId (pruned live no longer consulted)", () => {
    let s = initialMetricsState();
    s = foldMetricsEvent(s, doneEvent("t1", { contextSize: 111 }));
    s = applyDurableMetrics(s, [
      { turnId: "t1", usage: { inputTokens: 1, outputTokens: 1 }, steps: [], contextSize: 222 },
    ]);
    // The live (111) copy is pruned; only durable (222) remains.
    expect(s.live.has("t1")).toBe(false);
    expect(selectCurrentContextSize(s)).toBe(222);
  });
});
