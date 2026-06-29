import type { ReasoningEffort } from "@dispatch/transport-contract";

/**
 * Pure core types for the heartbeat feature — zero DOM, zero effects, zero Svelte.
 *
 * Heartbeat is a workspace-scoped autonomous agent loop: the backend periodically
 * runs a turn in a dedicated conversation using a configured system prompt, task
 * prompt, model, reasoning effort, and interval. The FE exposes the config
 * (`GET`/`PUT /workspaces/:id/heartbeat`), the run history
 * (`GET /workspaces/:id/heartbeat/runs`), and a per-run stop
 * (`POST /workspaces/:id/heartbeat/runs/:runId/stop`).
 *
 * The backend's heartbeat API is a plain REST surface — it is NOT part of the
 * shared `@dispatch/transport-contract` / `@dispatch/wire` packages (verified:
 * no `heartbeat` symbol in either `dist/`). So, following the consumer-defines-
 * port pattern (mirrors `features/mcp` / `features/computer` result types), the
 * FE owns these shapes here and adapts the untyped JSON at the network seam in
 * the composition root. If the backend later promotes these to a shared contract
 * package, swap the local types for the imports (see `backend-handoff.md`).
 */

/** The canonical run lifecycle status (backend-owned enum, verbatim). */
export type HeartbeatRunStatus = "running" | "completed" | "stopped";

/** The workspace's heartbeat configuration (`GET /workspaces/:id/heartbeat`). */
export interface HeartbeatConfig {
  /** Whether the autonomous loop is enabled (running on the interval). */
  readonly enabled: boolean;
  /**
   * When true (the default), the heartbeat SKIPS a fire whenever the configured
   * workspace has any active agents (a conversation whose persisted status is
   * `"active"` or `"queued"`) — it stays quiet while the user is actively
   * working and only fires when the workspace is idle. When false, the heartbeat
   * fires unconditionally on every interval. The heartbeat-spawned conversation
   * lives in a dedicated workspace, so an in-flight run never self-blocks.
   */
  readonly inactiveOnly: boolean;
  readonly systemPrompt: string;
  readonly taskPrompt: string;
  /** Minutes between runs. */
  readonly intervalMinutes: number;
  /** The model name (`<credential>/<model>`) the heartbeat runs with. */
  readonly model: string;
  /**
   * The heartbeat's reasoning effort, or null when never set (the server
   * default `"high"` then applies) — mirrors the per-conversation knob's
   * resolution chain.
   */
  readonly reasoningEffort: ReasoningEffort | null;
}

/**
 * A partial config patch for `PUT /workspaces/:id/heartbeat`. Every field is
 * optional — the backend merges the patch onto the stored config.
 */
export interface HeartbeatConfigPatch {
  readonly enabled?: boolean;
  readonly inactiveOnly?: boolean;
  readonly systemPrompt?: string;
  readonly taskPrompt?: string;
  readonly intervalMinutes?: number;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort | null;
}

/** One heartbeat run (`GET /workspaces/:id/heartbeat/runs`). */
export interface HeartbeatRun {
  readonly id: string;
  /** The conversation this run wrote to (watch it live for the chat). */
  readonly conversationId: string;
  /** ISO timestamp of when the run was triggered. */
  readonly triggeredAt: string;
  readonly status: HeartbeatRunStatus;
}

// ── Injected ports (consumer-defines-port; the composition root adapts the
//    store's HTTP calls to these shapes). ──────────────────────────────────────

/** Outcome of `GET /workspaces/:id/heartbeat` (or the PUT response). */
export type HeartbeatConfigResult =
  | { readonly ok: true; readonly config: HeartbeatConfig }
  | { readonly ok: false; readonly error: string };

/** Outcome of `GET /workspaces/:id/heartbeat/runs`. */
export type HeartbeatRunsResult =
  | { readonly ok: true; readonly runs: readonly HeartbeatRun[] }
  | { readonly ok: false; readonly error: string };

/** Outcome of `POST /workspaces/:id/heartbeat/runs/:runId/stop`. */
export type HeartbeatStopResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export type LoadHeartbeatConfig = () => Promise<HeartbeatConfigResult | null>;
export type SaveHeartbeatConfig = (
  patch: HeartbeatConfigPatch,
) => Promise<HeartbeatConfigResult | null>;
export type LoadHeartbeatRuns = () => Promise<HeartbeatRunsResult | null>;
export type StopHeartbeatRun = (runId: string) => Promise<HeartbeatStopResult | null>;

/**
 * Outcome of `GET /workspaces/:id/heartbeat/next-run` — the server-authoritative
 * timestamp of the next scheduled heartbeat run (ISO 8601 string), or `null`
 * when the heartbeat is disabled or no run is scheduled. The FE computes a live
 * countdown from this + a 1s clock (see `formatCountdown`). When the endpoint is
 * unavailable (404 — backend hasn't shipped it yet), the FE falls back to an
 * approximation from the runs + config (see `approximateNextRunEpoch`).
 */
export type HeartbeatNextRunResult =
  | { readonly ok: true; readonly nextRunAt: string | null }
  | { readonly ok: false; readonly error: string };

export type LoadHeartbeatNextRun = () => Promise<HeartbeatNextRunResult | null>;
