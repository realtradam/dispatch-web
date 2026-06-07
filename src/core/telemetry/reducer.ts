import type { AgentEvent, StepId, Usage } from "@dispatch/wire";
import type { StepMetrics, TelemetryState, TurnMetrics } from "./types";

/** The initial empty telemetry state. */
export function initialState(): TelemetryState {
	return { turns: new Map() };
}

function mergeStep(existing: StepMetrics, patch: StepMetrics): StepMetrics {
	const merged: StepMetrics = { ...existing };
	if (patch.ttftMs !== undefined) (merged as { ttftMs?: number }).ttftMs = patch.ttftMs;
	if (patch.decodeMs !== undefined) (merged as { decodeMs?: number }).decodeMs = patch.decodeMs;
	if (patch.genTotalMs !== undefined)
		(merged as { genTotalMs?: number }).genTotalMs = patch.genTotalMs;
	if (patch.usage !== undefined) {
		(merged as { usage?: Usage }).usage = { ...existing.usage, ...patch.usage };
	}
	if (patch.toolDurationMs !== undefined) {
		(merged as { toolDurationMs?: number }).toolDurationMs =
			(existing.toolDurationMs ?? 0) + patch.toolDurationMs;
	}
	return merged;
}

function upsertStep(
	steps: readonly StepMetrics[],
	stepId: StepId,
	patch: StepMetrics,
): readonly StepMetrics[] {
	const idx = steps.findIndex((s) => s.stepId === stepId);
	if (idx === -1) {
		return [...steps, patch];
	}
	return [...steps.slice(0, idx), mergeStep(steps[idx]!, patch), ...steps.slice(idx + 1)];
}

function setTurn(
	turns: ReadonlyMap<string, TurnMetrics>,
	turnId: string,
	turn: TurnMetrics,
): ReadonlyMap<string, TurnMetrics> {
	const next = new Map(turns);
	next.set(turnId, turn);
	return next;
}

/**
 * Fold one live AgentEvent into the telemetry state.
 *
 * - `turn-start` records the active turnId.
 * - `step-complete` creates/updates the step's timing metrics.
 * - `usage` merges token counts into the step (joined by `stepId`).
 * - `tool-result` accumulates `durationMs` into the step.
 * - `done` records turn-level wall-clock + token totals.
 * - All other event types are no-ops (content events belong to the transcript).
 *
 * Pure: input → output, no DOM, no side effects.
 */
export function foldMetricEvent(state: TelemetryState, event: AgentEvent): TelemetryState {
	switch (event.type) {
		case "turn-start": {
			return {
				...state,
				turns: setTurn(state.turns, event.turnId, { steps: [] }),
			};
		}

		case "step-complete": {
			const turnId = event.turnId;
			const existing = state.turns.get(turnId);
			const patch: StepMetrics = { stepId: event.stepId };
			if (event.ttftMs !== undefined) (patch as { ttftMs?: number }).ttftMs = event.ttftMs;
			if (event.decodeMs !== undefined) (patch as { decodeMs?: number }).decodeMs = event.decodeMs;
			if (event.genTotalMs !== undefined)
				(patch as { genTotalMs?: number }).genTotalMs = event.genTotalMs;
			const steps =
				existing !== undefined ? upsertStep(existing.steps, event.stepId, patch) : [patch];
			return {
				...state,
				turns: setTurn(state.turns, turnId, { ...existing, steps } as TurnMetrics),
			};
		}

		case "usage": {
			if (event.stepId === undefined) return state;
			const turnId = event.turnId;
			const existing = state.turns.get(turnId);
			const patch: StepMetrics = { stepId: event.stepId, usage: event.usage };
			const steps =
				existing !== undefined ? upsertStep(existing.steps, event.stepId, patch) : [patch];
			return {
				...state,
				turns: setTurn(state.turns, turnId, { ...existing, steps } as TurnMetrics),
			};
		}

		case "tool-result": {
			if (event.durationMs === undefined) return state;
			const turnId = event.turnId;
			const existing = state.turns.get(turnId);
			if (existing === undefined) return state;
			const patch: StepMetrics = { stepId: event.stepId, toolDurationMs: event.durationMs };
			const steps = upsertStep(existing.steps, event.stepId, patch);
			return { ...state, turns: setTurn(state.turns, turnId, { ...existing, steps }) };
		}

		case "done": {
			const turnId = event.turnId;
			const existing = state.turns.get(turnId);
			const updated: TurnMetrics = {
				...(existing ?? { steps: [] }),
			};
			if (event.durationMs !== undefined)
				(updated as { wallMs?: number }).wallMs = event.durationMs;
			if (event.usage !== undefined) (updated as { doneUsage?: Usage }).doneUsage = event.usage;
			return { ...state, turns: setTurn(state.turns, turnId, updated) };
		}

		default:
			return state;
	}
}
