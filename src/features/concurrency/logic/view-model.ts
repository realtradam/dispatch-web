import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
import type { ConcurrencyLimitEntry } from "./types";

/**
 * Pure view-models for the concurrency feature — zero DOM, zero effects, zero
 * Svelte. Maps backend `ConcurrencyLimitEntry` / `ConcurrencyStatusEntry` to
 * display shapes (badges, "2/4" in-flight labels, pause countdowns, summaries),
 * holds the limit-input parsing, and the network-seam normalizers the composition
 * root coerces the untyped JSON with.
 */

export type Badge = "success" | "warning" | "error" | "neutral";

/** A configured limit row shaped for display. */
export interface ConcurrencyLimitView {
  readonly providerId: string;
  readonly limit: number;
}

/**
 * A live status row shaped for display. Carries the raw counts plus pre-computed
 * labels so the template stays thin.
 */
export interface ConcurrencyStatusView {
  readonly providerId: string;
  readonly limit: number;
  readonly inFlight: number;
  readonly queued: number;
  readonly paused: boolean;
  /** "2/4" — in-flight slots held vs the cap. */
  readonly inFlightLabel: string;
  /** "1 queued" / "no queue". */
  readonly queuedLabel: string;
  /** A pause label when paused, e.g. "paused — resumes in 30s"; null otherwise. */
  readonly pausedLabel: string | null;
  readonly badge: Badge;
  /** True when paused or at capacity (show a spinner). */
  readonly busy: boolean;
}

// ── Limit input parsing ───────────────────────────────────────────────────────

/**
 * Parse a raw limit input into a positive integer, or `null` when it is not a
 * valid positive integer. Accepts "4" → 4; rejects "0", "-1", "4.5", "", "abc".
 * Drives the Add/Save button's disabled state so an invalid value never reaches
 * the backend (the backend is still the authority — it 400s a non-positive body).
 */
export function parseLimitInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || !/^[0-9]+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Coerce an untrusted limit value into a positive integer (default 1). Used when
 * normalizing backend responses so a malformed `limit` can never be 0/negative.
 */
export function normalizeLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  const int = Math.floor(n);
  return int >= 1 ? int : 1;
}

// ── Status → display view ──────────────────────────────────────────────────────

const NO_LIMITS = "No limits configured";

/**
 * Format a remaining-ms delta as a short pause countdown: "30s", "1m 05s",
 * "resuming" (≤ 0). Pure via the injected `remainingMs`. The component recomputes
 * this on each status poll (every ~2s) — a 1s ticking timer is optional.
 */
export function formatPauseDuration(remainingMs: number): string {
  if (remainingMs <= 0) return "resuming";
  const totalSec = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

/**
 * The pause label for a status entry, or `null` when not paused. When paused with
 * a future `pausedUntil`, shows "paused — resumes in 30s"; when paused without a
 * usable timestamp, shows "paused". Pure via the injectable `now`.
 */
export function pauseLabel(
  paused: boolean,
  pausedUntil: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!paused) return null;
  if (typeof pausedUntil === "number" && Number.isFinite(pausedUntil)) {
    const remaining = pausedUntil - now;
    if (remaining > 0) return `paused — resumes in ${formatPauseDuration(remaining)}`;
  }
  // Paused without a usable future timestamp (missing, non-finite, or already
  // expired): the next status poll will clear `paused`. Show "paused" meanwhile.
  return "paused";
}

/**
 * Build a display view for a status entry. `now` is injectable for tests
 * (defaults to `Date.now()`); the composition-root component passes nothing in
 * production (it recomputes on each poll).
 */
export function viewConcurrencyStatus(
  entry: ConcurrencyStatusEntry,
  now: number = Date.now(),
): ConcurrencyStatusView {
  const limit = normalizeLimit(entry.limit);
  const inFlight = clampCount(entry.inFlight);
  const queued = clampCount(entry.queued);
  const paused = entry.paused === true;
  const atCapacity = inFlight >= limit;
  let badge: Badge;
  if (paused) badge = "warning";
  else if (atCapacity && queued > 0) badge = "warning";
  else if (inFlight > 0) badge = "success";
  else badge = "neutral";
  return {
    providerId: entry.providerId,
    limit,
    inFlight,
    queued,
    paused,
    inFlightLabel: `${inFlight}/${limit}`,
    queuedLabel: queued === 0 ? "no queue" : `${queued} queued`,
    pausedLabel: pauseLabel(paused, entry.pausedUntil, now),
    badge,
    busy: paused || (atCapacity && queued > 0),
  };
}

export function viewConcurrencyStatuses(
  entries: readonly ConcurrencyStatusEntry[],
  now: number = Date.now(),
): readonly ConcurrencyStatusView[] {
  return entries.map((e) => viewConcurrencyStatus(e, now));
}

/** A display view for a configured limit entry. */
export function viewConcurrencyLimit(entry: ConcurrencyLimitEntry): ConcurrencyLimitView {
  return { providerId: entry.providerId, limit: normalizeLimit(entry.limit) };
}

export function viewConcurrencyLimits(
  entries: readonly ConcurrencyLimitEntry[],
): readonly ConcurrencyLimitView[] {
  return entries.map(viewConcurrencyLimit);
}

// ── Summaries ──────────────────────────────────────────────────────────────────

/** A one-line summary of the configured limits list, e.g. "2 limits configured". */
export function summarizeLimits(limits: readonly ConcurrencyLimitEntry[]): string {
  if (limits.length === 0) return NO_LIMITS;
  return `${limits.length} limit${limits.length === 1 ? "" : "s"} configured`;
}

/**
 * A one-line summary of the live status, e.g.
 * "2 providers · 6/10 in flight · 1 queued · 1 paused". Only the queued / paused
 * fragments appear when non-zero.
 */
export function summarizeStatus(
  providers: readonly ConcurrencyStatusEntry[],
  now: number = Date.now(),
): string {
  if (providers.length === 0) return NO_LIMITS;
  let inFlight = 0;
  let limitTotal = 0;
  let queued = 0;
  let paused = 0;
  for (const p of providers) {
    const limit = normalizeLimit(p.limit);
    inFlight += clampCount(p.inFlight);
    limitTotal += limit;
    queued += clampCount(p.queued);
    if (p.paused === true) paused += 1;
  }
  const parts: string[] = [];
  parts.push(
    `${providers.length} provider${providers.length === 1 ? "" : "s"}`,
    `${inFlight}/${limitTotal} in flight`,
  );
  if (queued > 0) parts.push(`${queued} queued`);
  if (paused > 0) parts.push(`${paused} paused`);
  // Touch `now` so the summary recomputes alongside the per-row pause countdown.
  void now;
  return parts.join(" · ");
}

// ── Network-seam normalization (pure; called by the composition root) ───────────
//
// The concurrency responses are untyped JSON at runtime. The store coerces each
// defensively HERE (pure + tested) — a malformed/partial backend value (e.g. the
// extension returning `{}`) can never crash the renderer. Mirrors the
// `normalizeHeartbeatConfig` / inline `Array.isArray(data.servers)` guards.

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Coerce a non-negative count field to a non-negative integer (0 on garbage). */
function clampCount(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const int = Math.floor(n);
  return int >= 0 ? int : 0;
}

/** Coerce an untrusted `GET /concurrency/limits` body into a typed limit list. */
export function normalizeConcurrencyLimits(data: unknown): readonly ConcurrencyLimitEntry[] {
  if (!isRecord(data) || !Array.isArray(data.limits)) return [];
  const limits = data.limits as readonly unknown[];
  return limits
    .filter((r): r is Record<string, unknown> => isRecord(r))
    .map((r) => ({
      providerId: asString(r.providerId) ?? "",
      limit: normalizeLimit(r.limit),
    }))
    .filter((r) => r.providerId !== "");
}

/** Coerce an untrusted `GET`/`PUT /concurrency/limits/:id` body into a limit, or null. */
export function normalizeConcurrencyLimit(data: unknown): ConcurrencyLimitEntry | null {
  if (!isRecord(data)) return null;
  const providerId = asString(data.providerId);
  if (providerId === null) return null;
  return { providerId, limit: normalizeLimit(data.limit) };
}

/**
 * Coerce an untrusted `GET /concurrency/status` body into a typed status list.
 * `pausedUntil` is included only when it is a finite number (it is absent when
 * not paused).
 */
export function normalizeConcurrencyStatus(data: unknown): readonly ConcurrencyStatusEntry[] {
  if (!isRecord(data) || !Array.isArray(data.providers)) return [];
  const providers = data.providers as readonly unknown[];
  return providers
    .filter((r): r is Record<string, unknown> => isRecord(r))
    .map((r): ConcurrencyStatusEntry => {
      const base = {
        providerId: asString(r.providerId) ?? "",
        limit: normalizeLimit(r.limit),
        inFlight: clampCount(r.inFlight),
        queued: clampCount(r.queued),
        paused: r.paused === true,
      };
      const pausedUntil =
        typeof r.pausedUntil === "number" && Number.isFinite(r.pausedUntil)
          ? r.pausedUntil
          : undefined;
      return pausedUntil !== undefined ? { ...base, pausedUntil } : base;
    })
    .filter((r) => r.providerId !== "");
}
