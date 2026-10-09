import type { StepId, StepMetrics, TurnMetrics } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
  computeCachePct,
  computeContextUsage,
  computeExpectedCachePct,
  computeTps,
  formatCompactTokens,
  formatContextSize,
  viewCacheRate,
  viewExpectedCache,
  viewStepMetrics,
  viewTurnMetrics,
} from "./format";

describe("computeTps", () => {
  it("null when elapsed missing", () => {
    expect(computeTps(100, undefined)).toBeNull();
  });

  it("null when elapsed is zero", () => {
    expect(computeTps(100, 0)).toBeNull();
  });

  it("null when elapsed is negative", () => {
    expect(computeTps(100, -100)).toBeNull();
  });

  it("computes tokens per second", () => {
    expect(computeTps(1000, 2000)).toBe(500);
  });

  it("computes fractional tps", () => {
    expect(computeTps(100, 3000)).toBeCloseTo(33.33, 1);
  });
});

describe("viewStepMetrics", () => {
  it("formats tokens with thousands separator, tps, and durations", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 1234, outputTokens: 567 },
      ttftMs: 820,
      decodeMs: 1200,
      genTotalMs: 2020,
    };
    const view = viewStepMetrics(step, 0);
    expect(view.label).toBe("step 1");
    expect(view.tokensLabel).toBe("1,234 in / 567 out");
    expect(view.tps).toBe("473 tok/s");
    expect(view.ttft).toBe("820ms");
    expect(view.decode).toBe("1.2s");
    expect(view.genTotal).toBe("2.0s");
  });

  it("handles missing timing fields", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const view = viewStepMetrics(step, 0);
    expect(view.tps).toBeNull();
    expect(view.ttft).toBeNull();
    expect(view.decode).toBeNull();
    expect(view.genTotal).toBeNull();
  });

  it("formats duration < 1s as ms", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 10, outputTokens: 5 },
      ttftMs: 42,
    };
    const view = viewStepMetrics(step, 0);
    expect(view.ttft).toBe("42ms");
  });

  it("formats duration >= 1s as seconds", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 10, outputTokens: 5 },
      genTotalMs: 3200,
    };
    const view = viewStepMetrics(step, 0);
    expect(view.genTotal).toBe("3.2s");
  });

  it("uses step index for label", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    expect(viewStepMetrics(step, 2).label).toBe("step 3");
  });

  it("tps uses decodeMs (not genTotalMs)", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 100, outputTokens: 50 },
      decodeMs: 500,
      genTotalMs: 800,
    };
    const view = viewStepMetrics(step, 0);
    // 50 / (500/1000) = 100 tok/s, NOT 50/(800/1000)=62.5
    expect(view.tps).toBe("100 tok/s");
  });

  it("tps is null when decodeMs is absent (never falls back to genTotalMs, which includes TTFT)", () => {
    const step: StepMetrics = {
      stepId: "s1" as StepId,
      usage: { inputTokens: 100, outputTokens: 50 },
      genTotalMs: 800,
    };
    const view = viewStepMetrics(step, 0);
    expect(view.tps).toBeNull();
  });
});

describe("viewTurnMetrics", () => {
  it("formats total tokens and breakdown", () => {
    const turn: TurnMetrics = {
      turnId: "t1",
      usage: { inputTokens: 1000, outputTokens: 234 },
      durationMs: 5000,
      steps: [
        {
          stepId: "s1" as StepId,
          usage: { inputTokens: 1000, outputTokens: 234 },
          decodeMs: 3000,
          genTotalMs: 4000,
        },
      ],
    };
    const view = viewTurnMetrics(turn);
    expect(view.tokensLabel).toBe("234 tok out");
    expect(view.breakdown).toBe("1,000 in");
    expect(view.tps).toBe("78 tok/s");
    expect(view.duration).toBe("5.0s");
  });

  it("breakdown includes cache only when present", () => {
    const turn: TurnMetrics = {
      turnId: "t1",
      usage: { inputTokens: 1000, outputTokens: 234, cacheReadTokens: 500 },
      steps: [],
    };
    const view = viewTurnMetrics(turn);
    expect(view.breakdown).toBe("1,000 in (500 cached)");
  });

  it("breakdown omits cache when not present", () => {
    const turn: TurnMetrics = {
      turnId: "t1",
      usage: { inputTokens: 100, outputTokens: 50 },
      steps: [],
    };
    const view = viewTurnMetrics(turn);
    expect(view.breakdown).toBe("100 in");
  });

  it("tps is null when no step has decodeMs or genTotalMs", () => {
    const turn: TurnMetrics = {
      turnId: "t1",
      usage: { inputTokens: 100, outputTokens: 50 },
      steps: [
        {
          stepId: "s1" as StepId,
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      ],
    };
    const view = viewTurnMetrics(turn);
    expect(view.tps).toBeNull();
  });

  it("duration is null when durationMs absent", () => {
    const turn: TurnMetrics = {
      turnId: "t1",
      usage: { inputTokens: 100, outputTokens: 50 },
      steps: [],
    };
    const view = viewTurnMetrics(turn);
    expect(view.duration).toBeNull();
  });

  it("turn tps counts only steps that report decodeMs (both tokens and time)", () => {
    const turn: TurnMetrics = {
      turnId: "t1",
      usage: { inputTokens: 300, outputTokens: 150 },
      steps: [
        {
          stepId: "s1" as StepId,
          usage: { inputTokens: 100, outputTokens: 50 },
          decodeMs: 800,
          genTotalMs: 1000,
        },
        {
          stepId: "s2" as StepId,
          usage: { inputTokens: 200, outputTokens: 100 },
          genTotalMs: 2000,
        },
      ],
    };
    const view = viewTurnMetrics(turn);
    // only step1 is timed: 50 / (800/1000) = 62.5 → 63. step2 (no decodeMs)
    // contributes neither tokens nor time — never its TTFT-inflated genTotalMs.
    expect(view.tps).toBe("63 tok/s");
  });
});

describe("computeCachePct", () => {
  it("is cacheReadTokens / inputTokens as a rounded percentage", () => {
    expect(computeCachePct({ inputTokens: 2737, outputTokens: 10, cacheReadTokens: 2560 })).toBe(
      94,
    );
    expect(computeCachePct({ inputTokens: 2669, outputTokens: 10, cacheReadTokens: 384 })).toBe(14);
  });

  it("is 0 when cacheReadTokens absent (legitimate miss, not missing data)", () => {
    expect(computeCachePct({ inputTokens: 1000, outputTokens: 50 })).toBe(0);
  });

  it("is 0 when there are no input tokens (guard divide-by-zero)", () => {
    expect(computeCachePct({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 5 })).toBe(0);
  });

  it("clamps to 100 if read somehow exceeds input", () => {
    expect(computeCachePct({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 250 })).toBe(100);
  });
});

describe("viewCacheRate", () => {
  it("success level for a high hit rate (>= 66)", () => {
    const v = viewCacheRate({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 93 });
    expect(v.pct).toBe(93);
    expect(v.level).toBe("success");
    expect(v.isHit).toBe(true);
  });

  it("warning level for a mid hit rate (33..65)", () => {
    const v = viewCacheRate({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 54 });
    expect(v.pct).toBe(54);
    expect(v.level).toBe("warning");
  });

  it("error level for a low hit rate (< 33), including a legitimate 0%", () => {
    expect(viewCacheRate({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 14 }).level).toBe(
      "error",
    );
    const miss = viewCacheRate({ inputTokens: 1000, outputTokens: 50 });
    expect(miss.pct).toBe(0);
    expect(miss.level).toBe("error");
    expect(miss.isHit).toBe(false);
  });
});

describe("computeExpectedCachePct", () => {
  it("null when there is no prior turn (first turn has no baseline)", () => {
    expect(computeExpectedCachePct({ inputTokens: 100, outputTokens: 0 }, null)).toBeNull();
  });

  it("null when this turn has no first step", () => {
    expect(computeExpectedCachePct(undefined, { inputTokens: 100, outputTokens: 0 })).toBeNull();
  });

  it("null when the prior prompt was empty (denominator 0)", () => {
    const prev = { inputTokens: 0, outputTokens: 0 };
    expect(computeExpectedCachePct({ inputTokens: 10, outputTokens: 0 }, prev)).toBeNull();
  });

  it("100% when the first step reads back the whole prior final prompt", () => {
    // prev turn's last step sent 5149 tokens; this turn's first step (a
    // superset prompt) reads 5149 of them from cache.
    const prevLast = { inputTokens: 5149, outputTokens: 40, cacheReadTokens: 3000 };
    const first = { inputTokens: 8462, outputTokens: 0, cacheReadTokens: 5149 };
    expect(computeExpectedCachePct(first, prevLast)).toBe(100);
  });

  it("drops below 100% when the cache busted", () => {
    const prevLast = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 900 };
    const first = { inputTokens: 1200, outputTokens: 0, cacheReadTokens: 500 };
    expect(computeExpectedCachePct(first, prevLast)).toBe(50);
  });

  it("0% (not null) on a full miss", () => {
    const prevLast = { inputTokens: 1000, outputTokens: 0 };
    const first = { inputTokens: 1200, outputTokens: 0 };
    expect(computeExpectedCachePct(first, prevLast)).toBe(0);
  });

  it("is NOT inflated by multi-step turns (step-level, not turn sums)", () => {
    // A 10-step turn reads the same prefix 10x; the old turn-sum ratio read
    // ~10x the baseline and pinned at 100%. Step-level reflects the bust.
    const prevLast = { inputTokens: 50_000, outputTokens: 0, cacheReadTokens: 49_000 };
    const first = { inputTokens: 51_000, outputTokens: 0, cacheReadTokens: 10_000 };
    expect(computeExpectedCachePct(first, prevLast)).toBe(20);
  });

  it("clamps to 100", () => {
    const prevLast = { inputTokens: 100, outputTokens: 0 };
    const first = { inputTokens: 300, outputTokens: 0, cacheReadTokens: 250 };
    expect(computeExpectedCachePct(first, prevLast)).toBe(100);
  });
});

describe("viewExpectedCache", () => {
  it("null view when it cannot be derived (no prior turn)", () => {
    expect(viewExpectedCache({ inputTokens: 100, outputTokens: 0 }, null)).toBeNull();
  });

  it("success level + hit flag for full retention", () => {
    const prevLast = { inputTokens: 5146, outputTokens: 0 };
    const first = { inputTokens: 8462, outputTokens: 0, cacheReadTokens: 5146 };
    const v = viewExpectedCache(first, prevLast);
    expect(v?.pct).toBe(100);
    expect(v?.level).toBe("success");
    expect(v?.isHit).toBe(true);
  });
});

describe("formatContextSize", () => {
  it("formats a defined count with thousands separators", () => {
    expect(formatContextSize(34102)).toBe("34,102 tokens in context");
  });

  it("renders a placeholder for undefined (never 0)", () => {
    expect(formatContextSize(undefined)).toBe("context size unknown");
  });

  it("renders an explicit 0 as zero tokens (a real reported value)", () => {
    expect(formatContextSize(0)).toBe("0 tokens in context");
  });
});

describe("formatCompactTokens", () => {
  it("renders sub-1k counts as-is", () => {
    expect(formatCompactTokens(0)).toBe("0");
    expect(formatCompactTokens(812)).toBe("812");
  });

  it("renders thousands with one decimal (rounded ≥100k)", () => {
    expect(formatCompactTokens(12300)).toBe("12.3k");
    expect(formatCompactTokens(150000)).toBe("150k");
  });

  it("renders millions with one decimal", () => {
    expect(formatCompactTokens(1_200_000)).toBe("1.2M");
    expect(formatCompactTokens(1_000_000)).toBe("1.0M");
  });
});

describe("computeContextUsage", () => {
  it("computes an unrounded clamped percent against the limit", () => {
    const u = computeContextUsage(34102, 1_000_000);
    expect(u.current).toBe(34102);
    expect(u.max).toBe(1_000_000);
    expect(u.percent).toBeCloseTo(3.4102, 4);
  });

  it("treats unknown contextSize as current null (never 0)", () => {
    const u = computeContextUsage(undefined, 1_000_000);
    expect(u.current).toBeNull();
    expect(u.percent).toBeNull();
  });

  it("an explicit 0 context size is a real reported value (current 0)", () => {
    const u = computeContextUsage(0, 1_000_000);
    expect(u.current).toBe(0);
    expect(u.percent).toBe(0);
  });

  it("clamps percent to [0,100] and over-limit reads 100", () => {
    expect(computeContextUsage(2_000_000, 1_000_000).percent).toBe(100);
  });

  it("max null (no/zero limit) ⇒ percent null", () => {
    expect(computeContextUsage(5000, null).percent).toBeNull();
    expect(computeContextUsage(5000, 0).percent).toBeNull();
    expect(computeContextUsage(5000, null).max).toBeNull();
  });
});
