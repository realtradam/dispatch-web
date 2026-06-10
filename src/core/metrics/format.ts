import type { StepMetrics, TurnMetrics, Usage } from "@dispatch/wire";
import type { StepMetricsView, TurnMetricsView } from "./types";

function formatTokens(n: number): string {
	return n.toLocaleString("en-US");
}

function formatDuration(ms: number | undefined): string | null {
	if (ms === undefined || ms <= 0) return null;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatTps(tps: number | null): string | null {
	if (tps === null) return null;
	if (tps < 10) return `${tps.toFixed(1)} tok/s`;
	return `${Math.round(tps)} tok/s`;
}

/** Compute tokens-per-second. Returns null when elapsed time is absent or zero. */
export function computeTps(outputTokens: number, elapsedMs: number | undefined): number | null {
	if (elapsedMs === undefined || elapsedMs <= 0) return null;
	return outputTokens / (elapsedMs / 1000);
}

function totalTokens(u: Usage): number {
	return u.inputTokens + u.outputTokens;
}

function formatBreakdown(u: Usage): string {
	let s = `${formatTokens(u.inputTokens)} in / ${formatTokens(u.outputTokens)} out`;
	if (u.cacheReadTokens !== undefined && u.cacheReadTokens > 0) {
		s += ` / ${formatTokens(u.cacheReadTokens)} cache`;
	}
	return s;
}

/** Build a formatted view of a single step's metrics. */
export function viewStepMetrics(step: StepMetrics, index: number): StepMetricsView {
	const total = totalTokens(step.usage);
	const tps = computeTps(step.usage.outputTokens, step.decodeMs ?? step.genTotalMs);
	return {
		label: `step ${index + 1}`,
		tokensLabel: `${formatTokens(total)} tok`,
		tps: formatTps(tps),
		ttft: formatDuration(step.ttftMs),
		decode: formatDuration(step.decodeMs),
		genTotal: formatDuration(step.genTotalMs),
	};
}

/** Build a formatted view of a turn's aggregate metrics. */
export function viewTurnMetrics(turn: TurnMetrics): TurnMetricsView {
	const total = totalTokens(turn.usage);
	let totalGenMs: number | undefined;
	for (const step of turn.steps) {
		const stepMs = step.decodeMs ?? step.genTotalMs;
		if (stepMs !== undefined) {
			totalGenMs = (totalGenMs ?? 0) + stepMs;
		}
	}
	const tps = computeTps(turn.usage.outputTokens, totalGenMs);
	return {
		tokensLabel: `${formatTokens(total)} tok`,
		breakdown: formatBreakdown(turn.usage),
		tps: formatTps(tps),
		duration: formatDuration(turn.durationMs),
	};
}
