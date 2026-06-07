import type { Usage } from "@dispatch/wire";
import type { StepMetrics, TelemetryState, TurnMetrics } from "./types";

/** Get the metrics for a specific step within a turn. */
export function stepMetrics(
	state: TelemetryState,
	turnId: string,
	stepIndex: number,
): StepMetrics | undefined {
	return state.turns.get(turnId)?.steps[stepIndex];
}

/** Get the metrics for a turn. */
export function turnMetrics(state: TelemetryState, turnId: string): TurnMetrics | undefined {
	return state.turns.get(turnId);
}

/** The number of steps in a turn. */
export function stepCount(state: TelemetryState, turnId: string): number {
	return state.turns.get(turnId)?.steps.length ?? 0;
}

/** TTFT of the first step in a turn (the turn-visible first-token latency). */
export function turnTtft(state: TelemetryState, turnId: string): number | undefined {
	return state.turns.get(turnId)?.steps[0]?.ttftMs;
}

/** Sum of all steps' decode times in a turn. */
export function totalDecodeMs(state: TelemetryState, turnId: string): number | undefined {
	const steps = state.turns.get(turnId)?.steps;
	if (steps === undefined || steps.length === 0) return undefined;
	let total = 0;
	let found = false;
	for (const s of steps) {
		if (s.decodeMs !== undefined) {
			total += s.decodeMs;
			found = true;
		}
	}
	return found ? total : undefined;
}

/** Aggregate output tokens across all steps in a turn. */
export function totalOutputTokens(state: TelemetryState, turnId: string): number | undefined {
	const turn = state.turns.get(turnId);
	if (turn === undefined) return undefined;
	if (turn.doneUsage !== undefined) return turn.doneUsage.outputTokens;
	let total = 0;
	let found = false;
	for (const s of turn.steps) {
		if (s.usage?.outputTokens !== undefined) {
			total += s.usage.outputTokens;
			found = true;
		}
	}
	return found ? total : undefined;
}

/** Aggregate input tokens across all steps in a turn. */
export function totalInputTokens(state: TelemetryState, turnId: string): number | undefined {
	const turn = state.turns.get(turnId);
	if (turn === undefined) return undefined;
	if (turn.doneUsage !== undefined) return turn.doneUsage.inputTokens;
	let total = 0;
	let found = false;
	for (const s of turn.steps) {
		if (s.usage?.inputTokens !== undefined) {
			total += s.usage.inputTokens;
			found = true;
		}
	}
	return found ? total : undefined;
}

/** Derived TPS for a step: outputTokens / (decodeMs / 1000). */
export function stepTps(step: StepMetrics): number | undefined {
	if (step.usage?.outputTokens === undefined || step.decodeMs === undefined) return undefined;
	if (step.decodeMs === 0) return undefined;
	return step.usage.outputTokens / (step.decodeMs / 1000);
}

/** Derived aggregate TPS for a turn. */
export function turnTps(state: TelemetryState, turnId: string): number | undefined {
	const outTokens = totalOutputTokens(state, turnId);
	const decode = totalDecodeMs(state, turnId);
	if (outTokens === undefined || decode === undefined || decode === 0) return undefined;
	return outTokens / (decode / 1000);
}

/** Sum of tool execution durations within a step. */
export function stepToolDuration(step: StepMetrics): number | undefined {
	return step.toolDurationMs !== undefined && step.toolDurationMs > 0
		? step.toolDurationMs
		: undefined;
}
