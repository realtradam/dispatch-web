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
});
