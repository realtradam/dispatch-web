import type { AgentEvent, StepId, StepMetrics, TurnMetrics, Usage } from "@dispatch/wire";
import type { BuildingStep, LiveTurn, MetricsState, TurnMetricsEntry } from "./types";

function sumStepUsages(steps: readonly BuildingStep[]): Usage {
	let inputTokens = 0;
	let outputTokens = 0;
	let hasCacheRead = false;
	let hasCacheWrite = false;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;

	for (const step of steps) {
		if (step.usage === undefined) continue;
		inputTokens += step.usage.inputTokens;
		outputTokens += step.usage.outputTokens;
		if (step.usage.cacheReadTokens !== undefined && step.usage.cacheReadTokens > 0) {
			hasCacheRead = true;
			cacheReadTokens += step.usage.cacheReadTokens;
		}
		if (step.usage.cacheWriteTokens !== undefined && step.usage.cacheWriteTokens > 0) {
			hasCacheWrite = true;
			cacheWriteTokens += step.usage.cacheWriteTokens;
		}
	}

	const base: Usage = { inputTokens, outputTokens };
	if (hasCacheRead) {
		(base as { cacheReadTokens?: number }).cacheReadTokens = cacheReadTokens;
	}
	if (hasCacheWrite) {
		(base as { cacheWriteTokens?: number }).cacheWriteTokens = cacheWriteTokens;
	}
	return base;
}

function buildingStepToMetrics(bs: BuildingStep): StepMetrics {
	const usage: Usage = bs.usage ?? { inputTokens: 0, outputTokens: 0 };
	const base: StepMetrics = { stepId: bs.stepId as StepId, usage };
	if (bs.ttftMs !== undefined) {
		(base as { ttftMs?: number }).ttftMs = bs.ttftMs;
	}
	if (bs.decodeMs !== undefined) {
		(base as { decodeMs?: number }).decodeMs = bs.decodeMs;
	}
	if (bs.genTotalMs !== undefined) {
		(base as { genTotalMs?: number }).genTotalMs = bs.genTotalMs;
	}
	return base;
}

function getStep(lt: LiveTurn, id: string): BuildingStep {
	const step = lt.stepMap.get(id);
	if (step === undefined) throw new Error(`Missing step ${id} in live turn`);
	return step;
}

function liveTurnToMetrics(lt: LiveTurn): TurnMetrics {
	const buildingSteps = lt.stepOrder.map((id) => getStep(lt, id));
	const steps = buildingSteps.map((bs) => buildingStepToMetrics(bs));
	const usage = lt.doneUsage ?? sumStepUsages(buildingSteps);
	const base: TurnMetrics = { turnId: lt.turnId, usage, steps };
	if (lt.durationMs !== undefined) {
		(base as { durationMs?: number }).durationMs = lt.durationMs;
	}
	if (lt.doneContextSize !== undefined) {
		(base as { contextSize?: number }).contextSize = lt.doneContextSize;
	}
	return base;
}

function ensureLiveTurn(state: MetricsState, turnId: string): [MetricsState, LiveTurn] {
	const existing = state.live.get(turnId);
	if (existing !== undefined) return [state, existing];

	const newTurn: LiveTurn = {
		turnId,
		done: false,
		durationMs: undefined,
		doneUsage: undefined,
		doneContextSize: undefined,
		stepMap: new Map(),
		stepOrder: [],
	};
	const newLive = new Map(state.live);
	newLive.set(turnId, newTurn);
	return [{ ...state, live: newLive, liveOrder: [...state.liveOrder, turnId] }, newTurn];
}

function upsertStep(lt: LiveTurn, stepId: string, update: Partial<BuildingStep>): LiveTurn {
	const existing = lt.stepMap.get(stepId);
	if (existing !== undefined) {
		const merged: BuildingStep = {
			stepId,
			usage: update.usage ?? existing.usage,
			ttftMs: update.ttftMs ?? existing.ttftMs,
			decodeMs: update.decodeMs ?? existing.decodeMs,
			genTotalMs: update.genTotalMs ?? existing.genTotalMs,
			complete: update.complete ?? existing.complete,
		};
		const newMap = new Map(lt.stepMap);
		newMap.set(stepId, merged);
		return { ...lt, stepMap: newMap };
	}

	const fresh: BuildingStep = {
		stepId,
		usage: update.usage,
		ttftMs: update.ttftMs,
		decodeMs: update.decodeMs,
		genTotalMs: update.genTotalMs,
		complete: update.complete ?? false,
	};
	const newMap = new Map(lt.stepMap);
	newMap.set(stepId, fresh);
	return { ...lt, stepMap: newMap, stepOrder: [...lt.stepOrder, stepId] };
}

/** The initial empty metrics state. */
export function initialMetricsState(): MetricsState {
	return {
		live: new Map(),
		liveOrder: [],
		durable: new Map(),
		durableOrder: [],
	};
}

/**
 * Fold one live AgentEvent into the metrics state.
 *
 * - `usage` with `stepId`: upsert that step's usage.
 * - `usage` without `stepId`: ignored.
 * - `step-complete`: upsert that step's timing; default usage to zeros if absent.
 * - `done`: set turn's `durationMs`, optional aggregate `usage`, and optional `contextSize`.
 * - All other event types: return state unchanged.
 */
export function foldMetricsEvent(state: MetricsState, event: AgentEvent): MetricsState {
	switch (event.type) {
		case "usage": {
			if (event.stepId === undefined) return state;
			const [s1, lt] = ensureLiveTurn(state, event.turnId);
			const updated = upsertStep(lt, event.stepId, { usage: event.usage });
			const newLive = new Map(s1.live);
			newLive.set(event.turnId, updated);
			return { ...s1, live: newLive };
		}

		case "step-complete": {
			const [s1, lt] = ensureLiveTurn(state, event.turnId);
			const updated = upsertStep(lt, event.stepId, {
				ttftMs: event.ttftMs,
				decodeMs: event.decodeMs,
				genTotalMs: event.genTotalMs,
				complete: true,
			});
			const newLive = new Map(s1.live);
			newLive.set(event.turnId, updated);
			return { ...s1, live: newLive };
		}

		case "done": {
			const [s1, lt] = ensureLiveTurn(state, event.turnId);
			const updated: LiveTurn = {
				...lt,
				done: true,
				durationMs: event.durationMs ?? lt.durationMs,
				doneUsage: event.usage ?? lt.doneUsage,
				doneContextSize: event.contextSize ?? lt.doneContextSize,
			};
			const newLive = new Map(s1.live);
			newLive.set(event.turnId, updated);
			return { ...s1, live: newLive };
		}

		default:
			return state;
	}
}

/**
 * Store durable (sealed) metrics from the backend. These win over live data
 * for any shared `turnId`.
 */
export function applyDurableMetrics(
	state: MetricsState,
	turns: readonly TurnMetrics[],
): MetricsState {
	const newDurable = new Map(state.durable);
	const newDurableOrder = [...state.durableOrder];
	for (const turn of turns) {
		if (!newDurable.has(turn.turnId)) {
			newDurableOrder.push(turn.turnId);
		}
		newDurable.set(turn.turnId, turn);
	}
	return {
		...state,
		durable: newDurable,
		durableOrder: newDurableOrder,
	};
}

/**
 * Select the merged ordered list of turn metrics entries.
 * Durable turns come first (in their order), then any live turns whose
 * `turnId` is not in durable (in live first-seen order).
 *
 * Each entry contains the completed steps so far and an optional total
 * (null until the turn is finalized via `done` or durable data).
 * Live turns with no completed steps and not done are omitted.
 */
export function selectOrderedTurnMetrics(state: MetricsState): readonly TurnMetricsEntry[] {
	const result: TurnMetricsEntry[] = [];
	const seen = new Set<string>();

	for (const turnId of state.durableOrder) {
		const tm = state.durable.get(turnId);
		if (tm !== undefined) {
			result.push({ turnId, steps: tm.steps, total: tm });
			seen.add(turnId);
		}
	}

	for (const turnId of state.liveOrder) {
		if (seen.has(turnId)) continue;
		const lt = state.live.get(turnId);
		if (lt === undefined) continue;

		const completeSteps = lt.stepOrder
			.map((id) => lt.stepMap.get(id))
			.filter((s): s is BuildingStep => s?.complete === true)
			.map((s) => buildingStepToMetrics(s));

		if (completeSteps.length === 0 && !lt.done) continue;

		result.push({
			turnId,
			steps: completeSteps,
			total: lt.done ? liveTurnToMetrics(lt) : null,
		});
	}

	return result;
}

/**
 * Select the conversation's CURRENT context size — the tokens it occupies right
 * now. Per the wire contract a client reads the LATEST turn's `contextSize`; we
 * scan the merged ordered turns NEWEST → OLDEST and return the first DEFINED
 * `contextSize` (a finalized turn whose provider reported per-step usage).
 *
 * Returns `undefined` ("unknown") when no finalized turn carries a context size —
 * the caller renders a placeholder, NEVER `0`. Durable (sealed) data wins over
 * live for a shared `turnId` (it is the persisted, authoritative value).
 */
export function selectCurrentContextSize(state: MetricsState): number | undefined {
	const ordered = selectOrderedTurnMetrics(state);
	for (let i = ordered.length - 1; i >= 0; i--) {
		const total = ordered[i]?.total;
		if (total?.contextSize !== undefined) return total.contextSize;
	}
	return undefined;
}
