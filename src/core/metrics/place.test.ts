import type { StepId, StepMetrics, TurnMetrics } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import type { RenderGroup } from "../chunks";
import { interleaveTurnMetrics } from "./place";
import type { TurnMetricsEntry } from "./types";

function userGroup(seq: number, text: string): RenderGroup {
	return {
		kind: "single",
		chunk: {
			seq,
			role: "user",
			chunk: { type: "text", text },
			provisional: false,
		},
	};
}

function assistantGroup(seq: number, text: string): RenderGroup {
	return {
		kind: "single",
		chunk: {
			seq,
			role: "assistant",
			chunk: { type: "text", text },
			provisional: false,
		},
	};
}

function toolCallGroup(seq: number, stepId: string, toolCallId: string): RenderGroup {
	return {
		kind: "single",
		chunk: {
			seq,
			role: "assistant",
			chunk: {
				type: "tool-call",
				toolCallId,
				toolName: "test",
				input: {},
				stepId: stepId as StepId,
			},
			provisional: false,
		},
	};
}

function toolResultGroup(seq: number, stepId: string, toolCallId: string): RenderGroup {
	return {
		kind: "single",
		chunk: {
			seq,
			role: "tool",
			chunk: {
				type: "tool-result",
				toolCallId,
				toolName: "test",
				content: "",
				isError: false,
				stepId: stepId as StepId,
			},
			provisional: false,
		},
	};
}

function toolBatchGroup(stepId: string, toolCallIds: string[]): RenderGroup {
	return {
		kind: "tool-batch",
		stepId,
		entries: toolCallIds.map((id) => ({
			call: {
				type: "tool-call" as const,
				toolCallId: id,
				toolName: "test",
				input: {},
				stepId: stepId as StepId,
			},
			result: null,
		})),
		provisional: false,
	};
}

function makeStep(stepId: string, inputTokens: number, outputTokens: number): StepMetrics {
	return {
		stepId: stepId as StepId,
		usage: { inputTokens, outputTokens },
	};
}

function makeTurn(
	turnId: string,
	inputTokens: number,
	outputTokens: number,
	steps: StepMetrics[] = [],
): TurnMetrics {
	return {
		turnId,
		usage: { inputTokens, outputTokens },
		steps,
	};
}

function makeEntry(
	turnId: string,
	inputTokens: number,
	outputTokens: number,
	steps: StepMetrics[] = [],
): TurnMetricsEntry {
	return {
		turnId,
		steps,
		total: makeTurn(turnId, inputTokens, outputTokens, steps),
	};
}

function makeProgressiveEntry(turnId: string, steps: StepMetrics[]): TurnMetricsEntry {
	return {
		turnId,
		steps,
		total: null,
	};
}

function expectGroupAt(
	rows: readonly { readonly kind: string }[],
	index: number,
	expected: RenderGroup,
): void {
	const row = rows[index];
	expect(row?.kind).toBe("group");
	expect((row as { readonly group: RenderGroup } | undefined)?.group).toBe(expected);
}

function expectStepMetricsAt(
	rows: readonly { readonly kind: string }[],
	index: number,
	expectedStepId: string,
	expectedIndex: number,
): void {
	const row = rows[index];
	expect(row?.kind).toBe("step-metrics");
	const sm = row as { readonly step: StepMetrics; readonly index: number } | undefined;
	expect(sm?.step.stepId).toBe(expectedStepId);
	expect(sm?.index).toBe(expectedIndex);
}

function expectTurnMetricsAt(
	rows: readonly { readonly kind: string }[],
	index: number,
	expectedTurnId: string,
): void {
	const row = rows[index];
	expect(row?.kind).toBe("turn-metrics");
	expect((row as { readonly turn: TurnMetrics } | undefined)?.turn.turnId).toBe(expectedTurnId);
}

describe("interleaveTurnMetrics", () => {
	it("no metrics: rows are all groups, unchanged order", () => {
		const g1 = userGroup(1, "q");
		const g2 = assistantGroup(2, "a");
		const rows = interleaveTurnMetrics([g1, g2], []);
		expect(rows).toHaveLength(2);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
	});

	it("head-aligned: segment i gets entries[i]", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const g3 = userGroup(3, "q2");
		const g4 = assistantGroup(4, "a2");
		const step1 = makeStep("s1", 100, 50);
		const step2 = makeStep("s2", 200, 80);
		const rows = interleaveTurnMetrics(
			[g1, g2, g3, g4],
			[makeEntry("t1", 100, 50, [step1]), makeEntry("t2", 200, 80, [step2])],
		);

		expect(rows).toHaveLength(8);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectTurnMetricsAt(rows, 3, "t1");
		expectGroupAt(rows, 4, g3);
		expectGroupAt(rows, 5, g4);
		expectStepMetricsAt(rows, 6, "s2", 0);
		expectTurnMetricsAt(rows, 7, "t2");
	});

	it("a trailing segment with no entry (in-flight turn) renders no metrics", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const g3 = userGroup(3, "q2");
		const g4 = assistantGroup(4, "a2");
		const step = makeStep("s1", 100, 50);
		const rows = interleaveTurnMetrics([g1, g2, g3, g4], [makeEntry("t1", 100, 50, [step])]);

		expect(rows).toHaveLength(6);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectTurnMetricsAt(rows, 3, "t1");
		expectGroupAt(rows, 4, g3);
		expectGroupAt(rows, 5, g4);
	});

	it("single text-only turn: step row + turn-metrics both at tail", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const step = makeStep("s1", 100, 50);
		const turn = makeEntry("t1", 100, 50, [step]);
		const rows = interleaveTurnMetrics([g1, g2], [turn]);

		expect(rows).toHaveLength(4);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectTurnMetricsAt(rows, 3, "t1");
	});

	it("tool step anchors inline after its tool-batch group", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolBatchGroup("t#0", ["c1", "c2"]);
		const g3 = assistantGroup(3, "a1");
		const step0 = makeStep("t#0", 100, 50);
		const step1 = makeStep("t#1", 200, 80);
		const turn = makeEntry("t1", 300, 130, [step0, step1]);
		const rows = interleaveTurnMetrics([g1, g2, g3], [turn]);

		expect(rows).toHaveLength(6);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "t#0", 0);
		expectGroupAt(rows, 3, g3);
		expectStepMetricsAt(rows, 4, "t#1", 1);
		expectTurnMetricsAt(rows, 5, "t1");
	});

	it("single tool-call group anchors its step", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolCallGroup(2, "s1", "c1");
		const g3 = assistantGroup(3, "a1");
		const step = makeStep("s1", 100, 50);
		const turn = makeEntry("t1", 100, 50, [step]);
		const rows = interleaveTurnMetrics([g1, g2, g3], [turn]);

		expect(rows).toHaveLength(5);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectGroupAt(rows, 3, g3);
		expectTurnMetricsAt(rows, 4, "t1");
	});

	it("single tool-result group anchors its step", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolResultGroup(2, "s1", "c1");
		const g3 = assistantGroup(3, "a1");
		const step = makeStep("s1", 100, 50);
		const turn = makeEntry("t1", 100, 50, [step]);
		const rows = interleaveTurnMetrics([g1, g2, g3], [turn]);

		expect(rows).toHaveLength(5);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectGroupAt(rows, 3, g3);
		expectTurnMetricsAt(rows, 4, "t1");
	});

	it("multi-step: each tool step inline, final step + total at tail", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolBatchGroup("t#0", ["c1"]);
		const g3 = assistantGroup(2, "thinking");
		const g4 = toolBatchGroup("t#1", ["c2", "c3"]);
		const g5 = assistantGroup(3, "a1");
		const step0 = makeStep("t#0", 100, 50);
		const step1 = makeStep("t#1", 200, 80);
		const step2 = makeStep("t#2", 50, 20);
		const turn = makeEntry("t1", 350, 150, [step0, step1, step2]);
		const rows = interleaveTurnMetrics([g1, g2, g3, g4, g5], [turn]);

		expect(rows).toHaveLength(9);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "t#0", 0);
		expectGroupAt(rows, 3, g3);
		expectGroupAt(rows, 4, g4);
		expectStepMetricsAt(rows, 5, "t#1", 1);
		expectGroupAt(rows, 6, g5);
		expectStepMetricsAt(rows, 7, "t#2", 2);
		expectTurnMetricsAt(rows, 8, "t1");
	});

	it("multiple turns head-aligned with inline steps", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolBatchGroup("s1", ["c1"]);
		const g3 = assistantGroup(2, "a1");
		const g4 = userGroup(3, "q2");
		const g5 = assistantGroup(4, "a2");
		const step1 = makeStep("s1", 100, 50);
		const step2 = makeStep("s2", 200, 80);
		const rows = interleaveTurnMetrics(
			[g1, g2, g3, g4, g5],
			[makeEntry("t1", 100, 50, [step1]), makeEntry("t2", 200, 80, [step2])],
		);

		expect(rows).toHaveLength(9);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectGroupAt(rows, 3, g3);
		expectTurnMetricsAt(rows, 4, "t1");
		expectGroupAt(rows, 5, g4);
		expectGroupAt(rows, 6, g5);
		expectStepMetricsAt(rows, 7, "s2", 0);
		expectTurnMetricsAt(rows, 8, "t2");
	});

	it("unanchored step (stepId not in groups) falls back to tail before turn-metrics", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const step0 = makeStep("orphan", 100, 50);
		const turn = makeEntry("t1", 100, 50, [step0]);
		const rows = interleaveTurnMetrics([g1, g2], [turn]);

		expect(rows).toHaveLength(4);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "orphan", 0);
		expectTurnMetricsAt(rows, 3, "t1");
	});

	it("fewer metrics than segments: trailing segments are bare", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const g3 = userGroup(3, "q2");
		const g4 = assistantGroup(4, "a2");
		const g5 = userGroup(5, "q3");
		const g6 = assistantGroup(6, "a3");
		const step = makeStep("s1", 300, 120);
		const rows = interleaveTurnMetrics(
			[g1, g2, g3, g4, g5, g6],
			[makeEntry("t1", 300, 120, [step])],
		);

		expect(rows).toHaveLength(8);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectTurnMetricsAt(rows, 3, "t1");
		expectGroupAt(rows, 4, g3);
		expectGroupAt(rows, 5, g4);
		expectGroupAt(rows, 6, g5);
		expectGroupAt(rows, 7, g6);
	});

	it("in-flight turn (no durationMs) still produces step + turn rows", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const step = makeStep("s1", 100, 50);
		const turn: TurnMetricsEntry = {
			turnId: "t1",
			steps: [step],
			total: {
				turnId: "t1",
				usage: { inputTokens: 100, outputTokens: 50 },
				steps: [step],
			},
		};
		const rows = interleaveTurnMetrics([g1, g2], [turn]);

		expect(rows).toHaveLength(4);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectTurnMetricsAt(rows, 3, "t1");
		const metricsRow = rows[3] as { readonly turn: TurnMetrics } | undefined;
		expect(metricsRow?.turn.durationMs).toBeUndefined();
	});

	it("leading non-turn groups emit as plain group rows", () => {
		const g0 = assistantGroup(1, "system msg");
		const g1 = userGroup(2, "q1");
		const g2 = assistantGroup(3, "a1");
		const step = makeStep("s1", 100, 50);
		const rows = interleaveTurnMetrics([g0, g1, g2], [makeEntry("t1", 100, 50, [step])]);

		expect(rows).toHaveLength(5);
		expectGroupAt(rows, 0, g0);
		expect(rows[1]?.kind).toBe("group");
		expect(rows[2]?.kind).toBe("group");
		expectStepMetricsAt(rows, 3, "s1", 0);
		expectTurnMetricsAt(rows, 4, "t1");
	});

	it("more metrics than segments: only T entries placed (extra ignored)", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const step1 = makeStep("s1", 100, 50);
		const step2 = makeStep("s2", 200, 80);
		const rows = interleaveTurnMetrics(
			[g1, g2],
			[makeEntry("t1", 100, 50, [step1]), makeEntry("t2", 200, 80, [step2])],
		);

		expect(rows).toHaveLength(4);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectTurnMetricsAt(rows, 3, "t1");
	});

	it("turn with no steps emits only turn-metrics (no step-metrics)", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const rows = interleaveTurnMetrics([g1, g2], [makeEntry("t1", 100, 50)]);

		expect(rows).toHaveLength(3);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectTurnMetricsAt(rows, 2, "t1");
	});

	it("progressive: entry with steps but total=null emits step rows and NO turn-metrics row", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolBatchGroup("s1", ["c1"]);
		const g3 = assistantGroup(2, "a1");
		const step1 = makeStep("s1", 100, 50);
		const entry = makeProgressiveEntry("t1", [step1]);
		const rows = interleaveTurnMetrics([g1, g2, g3], [entry]);

		expect(rows).toHaveLength(4);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectGroupAt(rows, 3, g3);
	});

	it("entry with total emits step rows + a turn-metrics row", () => {
		const g1 = userGroup(1, "q1");
		const g2 = toolBatchGroup("s1", ["c1"]);
		const g3 = assistantGroup(2, "a1");
		const step1 = makeStep("s1", 100, 50);
		const entry = makeEntry("t1", 100, 50, [step1]);
		const rows = interleaveTurnMetrics([g1, g2, g3], [entry]);

		expect(rows).toHaveLength(5);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectGroupAt(rows, 3, g3);
		expectTurnMetricsAt(rows, 4, "t1");
	});

	it("progressive multi-step: unanchored steps at tail, no turn-metrics", () => {
		const g1 = userGroup(1, "q1");
		const g2 = assistantGroup(2, "a1");
		const step0 = makeStep("s1", 100, 50);
		const step1 = makeStep("s2", 200, 80);
		const entry = makeProgressiveEntry("t1", [step0, step1]);
		const rows = interleaveTurnMetrics([g1, g2], [entry]);

		expect(rows).toHaveLength(4);
		expectGroupAt(rows, 0, g1);
		expectGroupAt(rows, 1, g2);
		expectStepMetricsAt(rows, 2, "s1", 0);
		expectStepMetricsAt(rows, 3, "s2", 1);
	});
});
