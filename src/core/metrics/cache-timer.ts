import type { AgentEvent } from "@dispatch/wire";
import type { MetricsRow } from "./types";

/**
 * Pure core for the **cache timer** — how long the prompt cache has sat idle
 * between model requests. Anthropic's prompt cache (as used by the Claude Code
 * subscription) expires 5 minutes after its last hit, so the gaps BETWEEN
 * requests decide whether the next request reads from cache:
 *
 * - **step gap**: a step (one LLM round-trip) finished and its tools are
 *   executing. Starts at `step-complete`; stops when the step's last tool
 *   result arrives (the next request fires right after) or, failing that, when
 *   anything from the next step shows up. Its final value is **stamped** on
 *   that step (keyed by `stepId`).
 * - **turn gap**: the turn ended (`done` / `error`) and the conversation is
 *   waiting on the user. Stops when a new message is sent (locally, or a
 *   `user-message` / `turn-start` from another client) and is stamped on that
 *   turn (keyed by `turnId`).
 *
 * At most ONE gap runs at a time (`running`). Zero DOM, zero clock: every fold
 * takes the current time as an argument.
 */

/** Prompt-cache time-to-live: 5 minutes (drives the badge colour). */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** The timer counts up to this, then reads "10+ min". */
export const CACHE_TIMER_MAX_MS = 10 * 60 * 1000;

/** Within this much of the TTL the timer warns (colour only). */
const WARN_AT_MS = CACHE_TTL_MS - 60 * 1000;

/** A step gap in progress: the step's tools are executing. */
export interface RunningStepGap {
  readonly kind: "step";
  readonly turnId: string;
  readonly stepId: string;
  /** Epoch ms the step completed. */
  readonly startedAt: number;
  /** How many tool calls the step made (`0` → nothing to show; never stamped). */
  readonly toolCount: number;
  /** Tool calls still awaiting their result. */
  readonly pending: ReadonlySet<string>;
  /** Longest backend-reported tool `durationMs` seen so far for this step. */
  readonly maxToolMs: number;
}

/** A turn gap in progress: the turn ended and nothing has been sent since. */
export interface RunningTurnGap {
  readonly kind: "turn";
  /**
   * The turn that ended, or `null` when seeded from the backend's
   * `lastActivityAt` after a reload (no live `done` seen) — then it belongs to
   * the most recent turn, resolved positionally / via `lastTurnId` on stop.
   */
  readonly turnId: string | null;
  /** Epoch ms the turn ended. */
  readonly startedAt: number;
}

export type RunningGap = RunningStepGap | RunningTurnGap;

export interface CacheTimerState {
  readonly running: RunningGap | null;
  /** Stamped step gaps: `stepId` → elapsed ms. */
  readonly stepStamps: ReadonlyMap<string, number>;
  /** Stamped turn gaps: `turnId` → elapsed ms. */
  readonly turnStamps: ReadonlyMap<string, number>;
  /** Tool calls seen per step in the CURRENT turn (`stepId` → call ids). */
  readonly calls: ReadonlyMap<string, ReadonlySet<string>>;
  /** Tool results seen per step in the CURRENT turn (`stepId` → call ids). */
  readonly results: ReadonlyMap<string, ReadonlySet<string>>;
  /** Longest tool `durationMs` per step in the CURRENT turn. */
  readonly toolMs: ReadonlyMap<string, number>;
}

export function initialCacheTimerState(): CacheTimerState {
  return {
    running: null,
    stepStamps: new Map(),
    turnStamps: new Map(),
    calls: new Map(),
    results: new Map(),
    toolMs: new Map(),
  };
}

function addTo(
  map: ReadonlyMap<string, ReadonlySet<string>>,
  key: string,
  value: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const next = new Map(map);
  next.set(key, new Set([...(map.get(key) ?? []), value]));
  return next;
}

function withEntry(map: ReadonlyMap<string, number>, key: string, value: number) {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/**
 * Stop the running STEP gap (if any). A step that made tool calls is stamped
 * with `max(wall-clock elapsed, longest backend tool duration)` — the backend
 * figure keeps a late-join replay (whole step delivered in one burst, ~0
 * elapsed) honest. A step with no tool calls is discarded.
 */
function stopStep(state: CacheTimerState, now: number): CacheTimerState {
  const r = state.running;
  if (r === null || r.kind !== "step") return state;
  if (r.toolCount === 0) return { ...state, running: null };
  const elapsed = Math.max(0, now - r.startedAt, r.maxToolMs);
  return { ...state, running: null, stepStamps: withEntry(state.stepStamps, r.stepId, elapsed) };
}

/**
 * Stop the running TURN gap (if any) and stamp it on its turn. A seeded gap
 * (`turnId === null`) is stamped on `lastTurnId()` — the most recent turn's
 * id — or dropped when that is unknown.
 */
export function stopTurnGap(
  state: CacheTimerState,
  now: number,
  lastTurnId: () => string | undefined,
): CacheTimerState {
  const r = state.running;
  if (r === null || r.kind !== "turn") return state;
  const turnId = r.turnId ?? lastTurnId();
  if (turnId === undefined) return { ...state, running: null };
  const elapsed = Math.max(0, now - r.startedAt);
  return { ...state, running: null, turnStamps: withEntry(state.turnStamps, turnId, elapsed) };
}

/** A turn ended: close any step gap, forget the turn's tool bookkeeping, start the turn gap. */
function endTurn(state: CacheTimerState, turnId: string, now: number): CacheTimerState {
  const s = stopStep(state, now);
  return {
    ...s,
    running: { kind: "turn", turnId, startedAt: now },
    calls: new Map(),
    results: new Map(),
    toolMs: new Map(),
  };
}

/**
 * Fold one live event into the cache-timer state at time `now`. `lastTurnId`
 * resolves a seeded turn gap's turn when a new turn starts (see
 * `stopTurnGap`); it is only called in that case.
 */
export function foldCacheTimerEvent(
  state: CacheTimerState,
  event: AgentEvent,
  now: number,
  lastTurnId: () => string | undefined,
): CacheTimerState {
  const r = state.running;
  switch (event.type) {
    case "user-message":
    case "turn-start":
      // A new turn is starting — the user (here or elsewhere) sent a message.
      return stopTurnGap(state, now, lastTurnId);

    case "tool-call": {
      // A call from a DIFFERENT step means the next step is already streaming.
      const s = r?.kind === "step" && r.stepId !== event.stepId ? stopStep(state, now) : state;
      return { ...s, calls: addTo(s.calls, event.stepId, event.toolCallId) };
    }

    case "tool-result": {
      const results = addTo(state.results, event.stepId, event.toolCallId);
      const dur = event.durationMs ?? 0;
      const toolMs =
        dur > (state.toolMs.get(event.stepId) ?? 0)
          ? withEntry(state.toolMs, event.stepId, dur)
          : state.toolMs;
      let s: CacheTimerState = { ...state, results, toolMs };
      if (r?.kind === "step" && r.stepId === event.stepId) {
        const pending = new Set(r.pending);
        pending.delete(event.toolCallId);
        s = { ...s, running: { ...r, pending, maxToolMs: Math.max(r.maxToolMs, dur) } };
        // Every tool of the step has returned → the next request fires now.
        if (pending.size === 0) s = stopStep(s, now);
      }
      return s;
    }

    case "step-complete": {
      const s = stopStep(stopTurnGap(state, now, lastTurnId), now);
      const calls = s.calls.get(event.stepId) ?? new Set<string>();
      const done = s.results.get(event.stepId) ?? new Set<string>();
      const pending = new Set([...calls].filter((id) => !done.has(id)));
      return {
        ...s,
        running: {
          kind: "step",
          turnId: event.turnId,
          stepId: event.stepId,
          startedAt: now,
          toolCount: calls.size,
          pending,
          maxToolMs: s.toolMs.get(event.stepId) ?? 0,
        },
      };
    }

    case "text-delta":
    case "reasoning-delta":
    case "reasoning-end":
    case "provider-retry":
      // Output (or a retry) from the next request: the gap is over.
      return r?.kind === "step" ? stopStep(state, now) : state;

    case "usage":
      return r?.kind === "step" && event.stepId !== undefined && event.stepId !== r.stepId
        ? stopStep(state, now)
        : state;

    case "done":
    case "error":
      return endTurn(state, event.turnId, now);

    default:
      return state;
  }
}

/**
 * Seed a turn gap from an authoritative "last activity" timestamp (the
 * backend's `lastActivityAt`, for a conversation that is idle — e.g. after a
 * reload, when no live `done` was seen). Never overrides a running step gap;
 * a running turn gap keeps the LATER start. Non-finite input is ignored.
 */
export function seedTurnGap(state: CacheTimerState, at: number): CacheTimerState {
  if (!Number.isFinite(at)) return state;
  const r = state.running;
  if (r === null) return { ...state, running: { kind: "turn", turnId: null, startedAt: at } };
  if (r.kind === "turn" && at > r.startedAt) return { ...state, running: { ...r, startedAt: at } };
  return state;
}

// ── View ──────────────────────────────────────────────────────────────────────

/** Formatted cache-timer view: label + colour severity + capped flag. */
export interface CacheTimerView {
  /** `"m:ss"` up to 10 minutes, then `"10+ min"`. */
  readonly label: string;
  /** Colour by the 5-minute cache TTL (maps to DaisyUI `badge-{level}`). */
  readonly level: "success" | "warning" | "error";
  /** Whether the 10-minute display cap was reached (a live timer may stop ticking). */
  readonly capped: boolean;
}

/**
 * Build the view for `elapsedMs`. Colour tracks the cache TTL: success under
 * 4 min, warning in the last minute, error once the cache has likely expired.
 * Negative / non-finite elapsed (clock skew) clamps to `0:00`.
 */
export function viewCacheTimer(elapsedMs: number): CacheTimerView {
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const level = ms >= CACHE_TTL_MS ? "error" : ms >= WARN_AT_MS ? "warning" : "success";
  if (ms >= CACHE_TIMER_MAX_MS) return { label: "10+ min", level, capped: true };
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { label: `${minutes}:${seconds.toString().padStart(2, "0")}`, level, capped: false };
}

/**
 * Index of the most recent turn's metrics row — the LAST `turn-metrics` row,
 * provided no user message follows it. Where a SEEDED turn gap (no `turnId`)
 * renders. `null` when there is no such row.
 */
export function lastTurnRowIndex(rows: readonly MetricsRow[]): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined) continue;
    if (row.kind === "turn-metrics") return i;
    if (row.kind === "group" && row.group.kind === "single" && row.group.chunk.role === "user") {
      return null;
    }
  }
  return null;
}
