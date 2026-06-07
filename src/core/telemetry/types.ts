import type { StepId, Usage } from "@dispatch/wire";

/**
 * Per-step metrics, accumulated from `step-complete` + `usage` events.
 * All fields optional — absent when the backend had no clock or the step
 * produced no text/reasoning token.
 */
export interface StepMetrics {
	readonly stepId: StepId;
	readonly ttftMs?: number;
	readonly decodeMs?: number;
	readonly genTotalMs?: number;
	readonly usage?: Usage;
	readonly toolDurationMs?: number; // sum of tool-result.durationMs in this step
}

/**
 * Per-turn metrics, accumulated from `done` events + per-step aggregation.
 */
export interface TurnMetrics {
	readonly wallMs?: number;
	readonly doneUsage?: Usage;
	readonly steps: readonly StepMetrics[];
}

/**
 * Pure telemetry state — lives alongside but separate from TranscriptState.
 * Accumulates live-only metric events; never persisted (history has no metrics).
 * No "active turn" tracking — the consumer (store) passes the relevant turnId
 * to the selectors. Pure: events flow in, derived values flow out.
 */
export interface TelemetryState {
	/** turnId → TurnMetrics. Multiple turns accumulate (tab switching). */
	readonly turns: ReadonlyMap<string, TurnMetrics>;
}
