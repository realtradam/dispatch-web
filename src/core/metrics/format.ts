import type { StepMetrics, TurnMetrics, Usage } from "@dispatch/wire";
import type { CacheRateView, StepMetricsView, TurnMetricsView } from "./types";

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

/**
 * Cache hit rate as a 0..100 integer percentage: `cacheReadTokens / inputTokens`,
 * clamped to [0,1]. Absent cache field counts as 0; a 0% rate is legitimate (not
 * missing data). Returns 0 when there are no input tokens.
 */
export function computeCachePct(u: Usage): number {
	const read = u.cacheReadTokens ?? 0;
	if (u.inputTokens <= 0) return 0;
	const rate = read / u.inputTokens;
	const clamped = rate < 0 ? 0 : rate > 1 ? 1 : rate;
	return Math.round(clamped * 100);
}

/** Colour severity for a cache hit percentage (badge colour). */
function cacheLevel(pct: number): "success" | "warning" | "error" {
	if (pct >= 66) return "success";
	if (pct >= 33) return "warning";
	return "error";
}

/** Build a view of a cache hit rate (percentage + colour level + hit flag). */
export function viewCacheRate(u: Usage): CacheRateView {
	const pct = computeCachePct(u);
	return { pct, level: cacheLevel(pct), isHit: (u.cacheReadTokens ?? 0) > 0 };
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
