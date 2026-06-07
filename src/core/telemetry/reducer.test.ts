import type { StepId, Usage } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { foldMetricEvent, initialState } from "./reducer";
import {
	stepCount,
	stepMetrics,
	stepToolDuration,
	stepTps,
	totalDecodeMs,
	totalInputTokens,
	totalOutputTokens,
	turnMetrics,
	turnTps,
	turnTtft,
} from "./selectors";

const sid = (s: string) => s as StepId;

const usage = (turnId: string, stepId: string, u: Usage) => ({
	type: "usage" as const,
	conversationId: "c1",
	turnId,
	stepId: sid(stepId),
	usage: u,
});

const stepComplete = (
	turnId: string,
	stepId: string,
	timing: { ttftMs?: number; decodeMs?: number; genTotalMs?: number },
) => ({
	type: "step-complete" as const,
	conversationId: "c1",
	turnId,
	stepId: sid(stepId),
	...timing,
});

describe("foldMetricEvent", () => {
	it("turn-start initializes an empty turn", () => {
		const s = foldMetricEvent(initialState(), {
			type: "turn-start",
			conversationId: "c1",
			turnId: "t1",
		});
		expect(s.turns.get("t1")?.steps).toEqual([]);
	});

	it("step-complete populates timing on a new step", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(
			s,
			stepComplete("t1", "s0", { ttftMs: 300, decodeMs: 800, genTotalMs: 1100 }),
		);

		const step = stepMetrics(s, "t1", 0);
		expect(step?.ttftMs).toBe(300);
		expect(step?.decodeMs).toBe(800);
		expect(step?.genTotalMs).toBe(1100);
	});

	it("usage merges tokens into a step (joined by stepId)", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(s, stepComplete("t1", "s0", { genTotalMs: 500 }));
		s = foldMetricEvent(s, usage("t1", "s0", { inputTokens: 100, outputTokens: 50 }));

		const step = stepMetrics(s, "t1", 0);
		expect(step?.usage?.inputTokens).toBe(100);
		expect(step?.usage?.outputTokens).toBe(50);
		expect(step?.genTotalMs).toBe(500); // timing preserved
	});

	it("usage without stepId is ignored", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(s, {
			type: "usage",
			conversationId: "c1",
			turnId: "t1",
			usage: { inputTokens: 100, outputTokens: 50 },
			// no stepId
		});
		expect(s.turns.get("t1")?.steps).toEqual([]);
	});

	it("tool-result accumulates durationMs into its step", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(s, stepComplete("t1", "s0", {}));
		s = foldMetricEvent(s, {
			type: "tool-result",
			conversationId: "c1",
			turnId: "t1",
			stepId: sid("s0"),
			toolCallId: "tc1",
			toolName: "bash",
			content: "",
			isError: false,
			durationMs: 120,
		});
		s = foldMetricEvent(s, {
			type: "tool-result",
			conversationId: "c1",
			turnId: "t1",
			stepId: sid("s0"),
			toolCallId: "tc2",
			toolName: "bash",
			content: "",
			isError: false,
			durationMs: 80,
		});

		const step = stepMetrics(s, "t1", 0);
		expect(step?.toolDurationMs).toBe(200);
	});

	it("done records turn wall-clock and aggregate usage", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(s, {
			type: "done",
			conversationId: "c1",
			turnId: "t1",
			reason: "complete",
			durationMs: 4200,
			usage: { inputTokens: 800, outputTokens: 200 },
		});

		const turn = turnMetrics(s, "t1");
		expect(turn?.wallMs).toBe(4200);
		expect(turn?.doneUsage?.outputTokens).toBe(200);
	});

	it("events for an unknown turn are handled gracefully (step-complete, usage)", () => {
		const s = initialState();
		// step-complete for a turn we haven't started — creates the turn.
		const s2 = foldMetricEvent(s, stepComplete("t1", "s0", { ttftMs: 100 }));
		expect(s2.turns.get("t1")?.steps[0]?.ttftMs).toBe(100);
	});

	it("multiple steps accumulate in order", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(s, stepComplete("t1", "s0", { genTotalMs: 100 }));
		s = foldMetricEvent(s, stepComplete("t1", "s1", { genTotalMs: 200 }));

		expect(stepCount(s, "t1")).toBe(2);
		expect(stepMetrics(s, "t1", 0)?.genTotalMs).toBe(100);
		expect(stepMetrics(s, "t1", 1)?.genTotalMs).toBe(200);
	});

	it("non-metric events are no-ops", () => {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(s, {
			type: "text-delta",
			conversationId: "c1",
			turnId: "t1",
			delta: "hi",
		});
		s = foldMetricEvent(s, {
			type: "turn-sealed",
			conversationId: "c1",
			turnId: "t1",
		});
		expect(s.turns.get("t1")?.steps).toEqual([]);
	});
});

describe("selectors — derived metrics", () => {
	function populatedState() {
		let s = initialState();
		s = foldMetricEvent(s, { type: "turn-start", conversationId: "c1", turnId: "t1" });
		s = foldMetricEvent(
			s,
			stepComplete("t1", "s0", { ttftMs: 300, decodeMs: 700, genTotalMs: 1000 }),
		);
		s = foldMetricEvent(s, usage("t1", "s0", { inputTokens: 500, outputTokens: 100 }));
		s = foldMetricEvent(
			s,
			stepComplete("t1", "s1", { ttftMs: 200, decodeMs: 500, genTotalMs: 700 }),
		);
		s = foldMetricEvent(s, usage("t1", "s1", { inputTokens: 600, outputTokens: 80 }));
		s = foldMetricEvent(s, {
			type: "done",
			conversationId: "c1",
			turnId: "t1",
			reason: "complete",
			durationMs: 3500,
			usage: { inputTokens: 1100, outputTokens: 180 },
		});
		return s;
	}

	it("stepTps = outputTokens / (decodeMs / 1000)", () => {
		const s = populatedState();
		const step = stepMetrics(s, "t1", 0)!;
		expect(stepTps(step)).toBeCloseTo(100 / 0.7, 2);
	});

	it("turnTtft returns first step's ttftMs", () => {
		expect(turnTtft(populatedState(), "t1")).toBe(300);
	});

	it("totalDecodeMs sums all steps' decodeMs", () => {
		expect(totalDecodeMs(populatedState(), "t1")).toBe(1200);
	});

	it("turnTps = outputTokens / (totalDecodeMs / 1000)", () => {
		const s = populatedState();
		expect(turnTps(s, "t1")).toBeCloseTo(180 / 1.2, 2);
	});

	it("totalOutputTokens prefers done.usage over step sum", () => {
		const s = populatedState();
		expect(totalOutputTokens(s, "t1")).toBe(180); // from done.usage
	});

	it("totalInputTokens prefers done.usage over step sum", () => {
		const s = populatedState();
		expect(totalInputTokens(s, "t1")).toBe(1100);
	});

	it("stepToolDuration returns sum only when > 0", () => {
		const withTools = foldMetricEvent(
			foldMetricEvent(initialState(), { type: "turn-start", conversationId: "c1", turnId: "t1" }),
			{
				type: "tool-result",
				conversationId: "c1",
				turnId: "t1",
				stepId: sid("s0"),
				toolCallId: "tc1",
				toolName: "bash",
				content: "",
				isError: false,
				durationMs: 50,
			},
		);
		const step = stepMetrics(withTools, "t1", 0)!;
		expect(stepToolDuration(step)).toBe(50);
		expect(stepToolDuration({ stepId: sid("s0") })).toBeUndefined();
	});

	it("returns undefined for absent fields gracefully", () => {
		const s = initialState();
		expect(turnMetrics(s, "missing")).toBeUndefined();
		expect(turnTtft(s, "missing")).toBeUndefined();
		expect(turnTps(s, "missing")).toBeUndefined();
	});
});
