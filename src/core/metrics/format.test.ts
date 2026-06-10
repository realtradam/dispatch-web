import type { StepId, StepMetrics, TurnMetrics } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
	computeCachePct,
	computeTps,
	viewCacheRate,
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
