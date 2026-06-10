import type { StepMetrics, TurnMetrics, Usage } from "@dispatch/wire";
import type { RenderGroup } from "../chunks";

export type { StepMetrics, TurnMetrics };

/** A step being built from live events (may be incomplete). */
export interface BuildingStep {
	readonly stepId: string;
	readonly usage: Usage | undefined;
	readonly ttftMs: number | undefined;
	readonly decodeMs: number | undefined;
	readonly genTotalMs: number | undefined;
	readonly complete: boolean;
}

/** A turn being built from live events (in-flight). */
export interface LiveTurn {
	readonly turnId: string;
	readonly done: boolean;
	readonly durationMs: number | undefined;
	readonly doneUsage: Usage | undefined;
	readonly stepMap: ReadonlyMap<string, BuildingStep>;
	readonly stepOrder: readonly string[];
}

/**
 * Reducer state for per-turn / per-step token + timing metrics.
 *
 * - `live`: in-flight turns keyed by `turnId` in FIRST-SEEN order.
 * - `durable`: sealed turns keyed by `turnId` in the order they arrived.
 */
export interface MetricsState {
	readonly live: ReadonlyMap<string, LiveTurn>;
	readonly liveOrder: readonly string[];
	readonly durable: ReadonlyMap<string, TurnMetrics>;
	readonly durableOrder: readonly string[];
}

/** Per-turn placement entry: completed steps so far + optional turn total. */
export interface TurnMetricsEntry {
	readonly turnId: string;
	readonly steps: readonly StepMetrics[];
	readonly total: TurnMetrics | null;
}

/** A row in the interleaved transcript: a render group, per-step metrics, or turn metrics. */
export type MetricsRow =
	| { readonly kind: "group"; readonly group: RenderGroup }
	| { readonly kind: "step-metrics"; readonly step: StepMetrics; readonly index: number }
	| {
			readonly kind: "turn-metrics";
			readonly turn: TurnMetrics;
			/** Cumulative usage across all finalized turns up to and including this one. */
			readonly cumulativeUsage: Usage;
	  };

/** Formatted cache hit-rate view: percentage + colour severity + hit flag. */
export interface CacheRateView {
	/** Cache hit rate as a 0..100 integer percentage (`cacheReadTokens / inputTokens`). */
	readonly pct: number;
	/** Colour severity for a badge (maps to DaisyUI `badge-{level}`). */
	readonly level: "success" | "warning" | "error";
	/** Whether any input tokens were served from cache. */
	readonly isHit: boolean;
}

/** Formatted per-step view for display. */
export interface StepMetricsView {
	readonly label: string;
	readonly tokensLabel: string;
	readonly tps: string | null;
	readonly ttft: string | null;
	readonly decode: string | null;
	readonly genTotal: string | null;
}

/** Formatted per-turn view for display. */
export interface TurnMetricsView {
	readonly tokensLabel: string;
	readonly breakdown: string;
	readonly tps: string | null;
	readonly duration: string | null;
}
