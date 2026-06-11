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
		expect(view.tokensLabel).toBe("1,801 tok");
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

	it("tps falls back to genTotalMs when decodeMs absent", () => {
		const step: StepMetrics = {
			stepId: "s1" as StepId,
			usage: { inputTokens: 100, outputTokens: 50 },
			genTotalMs: 800,
		};
		const view = viewStepMetrics(step, 0);
		// 50 / (800/1000) = 62.5 → rounds to 63
		expect(view.tps).toBe("63 tok/s");
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
		expect(view.tokensLabel).toBe("1,234 tok");
		expect(view.breakdown).toBe("1,000 in / 234 out");
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
		expect(view.breakdown).toBe("1,000 in / 234 out / 500 cache");
	});

	it("breakdown omits cache when not present", () => {
		const turn: TurnMetrics = {
			turnId: "t1",
			usage: { inputTokens: 100, outputTokens: 50 },
			steps: [],
		};
		const view = viewTurnMetrics(turn);
		expect(view.breakdown).toBe("100 in / 50 out");
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

	it("sums decodeMs across steps (fallback genTotalMs per step) for tps", () => {
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
		// step1 uses decodeMs=800, step2 falls back to genTotalMs=2000 → total=2800ms
		// 150 / (2800/1000) = 53.57 → rounds to 54
		expect(view.tps).toBe("54 tok/s");
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

	it("null when the prior turn cached nothing (denominator 0)", () => {
		const prev = { inputTokens: 100, outputTokens: 0 };
		const current = { inputTokens: 200, outputTokens: 0, cacheReadTokens: 50 };
		expect(computeExpectedCachePct(current, prev)).toBeNull();
	});

	it("100% when the whole prior cached prefix was read back (backend worked example)", () => {
		// turn 1: cacheRead 0, cacheWrite 5146 → prefix 5146; turn 2 reads 5146 back.
		const prev = { inputTokens: 5149, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 5146 };
		const current = {
			inputTokens: 8462,
			outputTokens: 0,
			cacheReadTokens: 5146,
			cacheWriteTokens: 3313,
		};
		expect(computeExpectedCachePct(current, prev)).toBe(100);
	});

	it("drops below 100% when the cache busted (read < prior prefix)", () => {
		const prev = {
			inputTokens: 1000,
			outputTokens: 0,
			cacheReadTokens: 100,
			cacheWriteTokens: 900,
		};
		const current = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 500 };
		// 500 / (100 + 900) = 50%
		expect(computeExpectedCachePct(current, prev)).toBe(50);
	});

	it("clamps to 100 if read somehow exceeds the prior prefix", () => {
		const prev = { inputTokens: 100, outputTokens: 0, cacheWriteTokens: 100 };
		const current = { inputTokens: 100, outputTokens: 0, cacheReadTokens: 250 };
		expect(computeExpectedCachePct(current, prev)).toBe(100);
	});
});

describe("viewExpectedCache", () => {
	it("null view when it cannot be derived (no prior turn)", () => {
		expect(viewExpectedCache({ inputTokens: 100, outputTokens: 0 }, null)).toBeNull();
	});

	it("success level + hit flag for full retention", () => {
		const prev = { inputTokens: 5149, outputTokens: 0, cacheWriteTokens: 5146 };
		const current = { inputTokens: 8462, outputTokens: 0, cacheReadTokens: 5146 };
		const v = viewExpectedCache(current, prev);
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

	it("treats unknown contextSize as current 0", () => {
		const u = computeContextUsage(undefined, 1_000_000);
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
