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

/**
 * Format the current context size for display. A defined count renders as
 * `"<n> tokens in context"` (thousands-separated); `undefined` ("unknown" — no
 * per-step usage reported yet) renders the placeholder `"context size unknown"`.
 * Never renders `0` for the unknown case.
 */
export function formatContextSize(n: number | undefined): string {
  if (n === undefined) return "context size unknown";
  return `${formatTokens(n)} tokens in context`;
}

/**
 * Compact token count for a slim status bar: `812`, `12.3k`, `1.2M`. Full
 * thousands-separated numbers live elsewhere; this trades precision for width.
 */
export function formatCompactTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1)}M`;
}

/**
 * Context-window occupancy: the current size against a max window limit.
 *
 * `current` is the latest turn's context size, or `null` when unknown (no
 * per-step usage reported yet) — NEVER coerced to `0`, so a consumer cannot
 * silently render "0 tokens / 1M"; it must branch on `current === null` and show
 * a placeholder instead. `max` is the model's window limit (or `null` when
 * unknown). `percent` is `current / max * 100` clamped to [0, 100], UNROUNDED
 * (the UI picks the precision) — so a few-thousand-token context against a
 * 1,000,000 window still reads non-zero. `percent` is `null` when `current` OR
 * `max` is unknown (no bar/denominator).
 */
export interface ContextUsage {
  readonly current: number | null;
  readonly max: number | null;
  readonly percent: number | null;
}

export function computeContextUsage(
  contextSize: number | undefined,
  contextLimit: number | null | undefined,
): ContextUsage {
  const current = contextSize ?? null;
  const max = typeof contextLimit === "number" && contextLimit > 0 ? contextLimit : null;
  const percent =
    current === null || max === null ? null : Math.max(0, Math.min(100, (current / max) * 100));
  return { current, max, percent };
}

/** Compute tokens-per-second. Returns null when elapsed time is absent or zero. */
export function computeTps(outputTokens: number, elapsedMs: number | undefined): number | null {
  if (elapsedMs === undefined || elapsedMs <= 0) return null;
  return outputTokens / (elapsedMs / 1000);
}

function formatBreakdown(u: Usage): string {
  let s = `${formatTokens(u.inputTokens)} in`;
  if (u.cacheReadTokens !== undefined && u.cacheReadTokens > 0) {
    s += ` (${formatTokens(u.cacheReadTokens)} cached)`;
  }
  return s;
}

/**
 * A step's tokens-per-second: `outputTokens / decodeMs`. Decode time is the
 * model's generation window (first output token → stream end) with tool
 * execution excluded by the backend. `genTotalMs` is deliberately NOT a
 * fallback: it includes time-to-first-token (prompt processing / queueing),
 * which would understate the rate by multiples. No decode time → no TPS.
 */
function stepTps(step: StepMetrics): number | null {
  return computeTps(step.usage.outputTokens, step.decodeMs);
}

/** Build a formatted view of a single step's metrics. */
export function viewStepMetrics(step: StepMetrics, index: number): StepMetricsView {
  return {
    label: `step ${index + 1}`,
    tokensLabel: `${formatTokens(step.usage.inputTokens)} in / ${formatTokens(step.usage.outputTokens)} out`,
    tps: formatTps(stepTps(step)),
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

/**
 * Expected cache (retention): of the prompt the PREVIOUS turn last sent (its
 * final step's input), how much this turn's FIRST step read back from cache —
 * `clamp01(firstStep.cacheRead / prevLastStep.input)`. Everything in that
 * prompt is a prefix of this turn's first prompt, so ~100% means the cache
 * survived between turns; lower means it busted/expired. Step-level on both
 * sides: comparing whole-turn sums is meaningless (a multi-step turn reads
 * the same prefix once per step).
 *
 * Returns `null` when it cannot be derived: no earlier turn, no first step,
 * or the previous prompt was empty — distinct from a real 0%.
 */
export function computeExpectedCachePct(
  firstStep: Usage | undefined,
  prevLastStep: Usage | null,
): number | null {
  if (prevLastStep === null || firstStep === undefined) return null;
  const denom = prevLastStep.inputTokens;
  if (denom <= 0) return null;
  const read = firstStep.cacheReadTokens ?? 0;
  const rate = read / denom;
  const clamped = rate < 0 ? 0 : rate > 1 ? 1 : rate;
  return Math.round(clamped * 100);
}

/**
 * Build a view of the cross-turn retention (percentage + colour level + hit flag),
 * or `null` when it can't be derived (see `computeExpectedCachePct`).
 */
export function viewExpectedCache(
  firstStep: Usage | undefined,
  prevLastStep: Usage | null,
): CacheRateView | null {
  const pct = computeExpectedCachePct(firstStep, prevLastStep);
  if (pct === null) return null;
  return { pct, level: cacheLevel(pct), isHit: (firstStep?.cacheReadTokens ?? 0) > 0 };
}

/**
 * Build a formatted view of a turn's aggregate metrics.
 *
 * Turn TPS = output tokens ÷ decode time, summed over ONLY the steps that
 * report a decode time (both numerator and denominator), so a step without
 * timing can neither inflate nor deflate it. Tool execution between steps is
 * never part of any step's decode time.
 */
export function viewTurnMetrics(turn: TurnMetrics, turnNumber?: number): TurnMetricsView {
  let timedOut = 0;
  let decodeMs: number | undefined;
  for (const step of turn.steps) {
    if (step.decodeMs === undefined || step.decodeMs <= 0) continue;
    timedOut += step.usage.outputTokens;
    decodeMs = (decodeMs ?? 0) + step.decodeMs;
  }
  return {
    label: turnNumber !== undefined ? `turn ${turnNumber}` : "turn",
    tokensLabel: `${formatTokens(turn.usage.outputTokens)} tok out`,
    breakdown: formatBreakdown(turn.usage),
    tps: formatTps(computeTps(timedOut, decodeMs)),
    duration: formatDuration(turn.durationMs),
  };
}
