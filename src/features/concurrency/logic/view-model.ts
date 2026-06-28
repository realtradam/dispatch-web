import type {
  ConcurrencyCooldownResponse,
  ConcurrencyStatusEntry,
} from "@dispatch/transport-contract";
import type { ConcurrencyLimitEntry } from "./types";

/**
 * Pure view-models for the concurrency feature — zero DOM, zero effects, zero
 * Svelte. Maps backend `ConcurrencyLimitEntry` / `ConcurrencyStatusEntry` to
 * display shapes (badges, "2/4" in-flight labels, pause countdowns, cooldown
 * labels, auto-reduce banners, summaries), holds the limit/cooldown-input
 * parsing, and the network-seam normalizers the composition root coerces the
 * untyped JSON with.
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
  /** Per-slot release cooldown in ms (defensive default 350 on garbage). */
  readonly cooldownMs: number;
  /** "350ms" / "1.2s" / "0ms (off)" — display label for the cooldown. */
  readonly cooldownLabel: string;
  /** Whether the limit was auto-reduced by a 429 (one-way; user restores manually). */
  readonly autoReduced: boolean;
  /** The original limit before auto-reduction; null when not auto-reduced. */
  readonly autoReducedFrom: number | null;
}

/**
 * A view-model for the auto-reduce banner — derived from a status entry whose
 * `autoReduced` is `true`. `message` is the backend's `notice` when present, else
 * a synthesized fallback. `viewAutoReduce` returns this (or null) so the banner
 * section renders without reaching into the raw entry.
 */
export interface AutoReduceNotice {
  readonly providerId: string;
  readonly message: string;
  /** The original limit before reduction — the value "Restore to N" PUTs. */
  readonly fromLimit: number;
  /** The current (reduced) limit. */
  readonly currentLimit: number;
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

// ── Cooldown input parsing ────────────────────────────────────────────────────
//
// The per-slot release cooldown (ms) is a NON-NEGATIVE integer (0 = no cooldown,
// instant re-admission) — unlike the limit, 0 is a VALID value. The default is
// 350ms (the backend's server default when a limit is set but no explicit
// cooldown was configured). It is configurable + persisted per provider via
// `PUT /concurrency/cooldown/:providerId`.

/** The server's default cooldown (ms) — used when none is explicitly set. */
export const DEFAULT_COOLDOWN_MS = 350;

/**
 * Parse a raw cooldown input into a non-negative integer, or `null` when it is
 * not valid. Accepts "0" → 0, "350" → 350; rejects "-1", "4.5", "", "abc".
 * Drives the cooldown Save button's disabled state so an invalid value never
 * reaches the backend (the backend 400s a non-negative-integer body).
 */
export function parseCooldownInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || !/^[0-9]+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Coerce an untrusted cooldown value into a non-negative integer (default
 * {@link DEFAULT_COOLDOWN_MS}). Used when normalizing backend responses so a
 * malformed `cooldownMs` can never be negative/non-finite.
 */
export function normalizeCooldown(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_COOLDOWN_MS;
  const int = Math.floor(n);
  return int >= 0 ? int : DEFAULT_COOLDOWN_MS;
}

/**
 * Format a cooldown (ms) as a short display label:
 * 0 → "0ms (off)" · <1000 → "350ms" · ≥1000 → "1.2s" (trailing ".0" trimmed).
 */
export function cooldownLabel(ms: number): string {
  if (ms <= 0) return "0ms (off)";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  const fixed = secs.toFixed(1);
  return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}s`;
}

// ── Provider options (the Add-form dropdown) ───────────────────────────────────
//
// A concurrency `providerId` is the credential name that prefixes a model name
// (`<provider>/<model>` — the same key the model picker groups by). The dropdown
// is the UNION of providers discoverable from the available models AND providers
// already carrying a configured limit (so a limit set out-of-band but whose
// model list is empty still appears), in first-seen order. Models are the
// authority; a provider with models but no limit is still selectable (Add sets it).

/** The provider id prefix of a `<provider>/<model>` name (the part before the first `/`, or the whole string). */
export function providerFromModel(full: string): string {
  const i = full.indexOf("/");
  return i === -1 ? full : full.slice(0, i);
}

/** Distinct provider ids to offer in the Add dropdown, first-seen order. */
export function providerOptions(
  models: readonly string[],
  limits: readonly ConcurrencyLimitEntry[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string): void => {
    if (p !== "" && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const m of models) add(providerFromModel(m));
  for (const l of limits) add(l.providerId);
  return out;
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
 *
 * `autoReduced` does NOT flip `busy` (a reduced limit still admits agents; it is
 * a degraded-but-active state surfaced via the banner, not a spinner) — it only
 * nudges the badge to `warning` so the row signals attention.
 */
export function viewConcurrencyStatus(
  entry: ConcurrencyStatusEntry,
  now: number = Date.now(),
): ConcurrencyStatusView {
  const limit = normalizeLimit(entry.limit);
  const inFlight = clampCount(entry.inFlight);
  const queued = clampCount(entry.queued);
  const paused = entry.paused === true;
  const autoReduced = entry.autoReduced === true;
  const atCapacity = inFlight >= limit;
  let badge: Badge;
  if (paused) badge = "warning";
  else if (autoReduced) badge = "warning";
  else if (atCapacity && queued > 0) badge = "warning";
  else if (inFlight > 0) badge = "success";
  else badge = "neutral";
  const cooldownMs = normalizeCooldown(entry.cooldownMs);
  const autoReducedFrom =
    autoReduced &&
    typeof entry.autoReducedFrom === "number" &&
    Number.isFinite(entry.autoReducedFrom)
      ? normalizeLimit(entry.autoReducedFrom)
      : null;
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
    cooldownMs,
    cooldownLabel: cooldownLabel(cooldownMs),
    autoReduced,
    autoReducedFrom,
  };
}

/**
 * A short status word for a status view, for the row's status badge:
 * "Paused" · "At capacity" (in-flight at the cap with a queue) · "Active"
 * (in-flight > 0) · "Idle". Mirrors the badge-text branching so the template
 * holds no branching logic.
 */
export function statusLabel(view: ConcurrencyStatusView): string {
  if (view.paused) return "Paused";
  if (view.inFlight >= view.limit && view.queued > 0) return "At capacity";
  if (view.inFlight > 0) return "Active";
  return "Idle";
}

/**
 * The auto-reduce banner view for a status entry, or `null` when it is not
 * auto-reduced. `message` prefers the backend's `notice` (verbatim, when present
 * + non-empty); otherwise a synthesized fallback is built from
 * `autoReducedFrom` → `limit`. `fromLimit` is the value "Restore to N" PUTs back.
 */
export function viewAutoReduce(entry: ConcurrencyStatusEntry): AutoReduceNotice | null {
  if (entry.autoReduced !== true) return null;
  const currentLimit = normalizeLimit(entry.limit);
  const fromLimit =
    typeof entry.autoReducedFrom === "number" && Number.isFinite(entry.autoReducedFrom)
      ? normalizeLimit(entry.autoReducedFrom)
      : currentLimit + 1;
  const notice =
    typeof entry.notice === "string" && entry.notice.length > 0
      ? entry.notice
      : `Concurrency limit auto-reduced to ${currentLimit} after a 429 — restore manually when ready.`;
  return {
    providerId: entry.providerId,
    message: notice,
    fromLimit,
    currentLimit,
  };
}

/**
 * All auto-reduce banners across a status list (one per auto-reduced provider),
 * in input order. Empty when none are auto-reduced.
 */
export function autoReduceNotices(
  entries: readonly ConcurrencyStatusEntry[],
): readonly AutoReduceNotice[] {
  const out: AutoReduceNotice[] = [];
  for (const e of entries) {
    const n = viewAutoReduce(e);
    if (n !== null) out.push(n);
  }
  return out;
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
 * "2 providers · 6/10 in flight · 1 queued · 1 paused · 1 auto-reduced". Only the
 * queued / paused / auto-reduced fragments appear when non-zero.
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
  let autoReduced = 0;
  for (const p of providers) {
    const limit = normalizeLimit(p.limit);
    inFlight += clampCount(p.inFlight);
    limitTotal += limit;
    queued += clampCount(p.queued);
    if (p.paused === true) paused += 1;
    if (p.autoReduced === true) autoReduced += 1;
  }
  const parts: string[] = [];
  parts.push(
    `${providers.length} provider${providers.length === 1 ? "" : "s"}`,
    `${inFlight}/${limitTotal} in flight`,
  );
  if (queued > 0) parts.push(`${queued} queued`);
  if (paused > 0) parts.push(`${paused} paused`);
  if (autoReduced > 0) parts.push(`${autoReduced} auto-reduced`);
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
 * not paused). `cooldownMs` (default 350) + `autoReduced` are always coerced;
 * `autoReducedFrom` + `notice` are included only when `autoReduced` is true (and
 * well-formed), mirroring the backend's "present only when auto-reduced" contract.
 */
export function normalizeConcurrencyStatus(data: unknown): readonly ConcurrencyStatusEntry[] {
  if (!isRecord(data) || !Array.isArray(data.providers)) return [];
  const providers = data.providers as readonly unknown[];
  return providers
    .filter((r): r is Record<string, unknown> => isRecord(r))
    .map((r): ConcurrencyStatusEntry => {
      const providerId = asString(r.providerId) ?? "";
      const limit = normalizeLimit(r.limit);
      const inFlight = clampCount(r.inFlight);
      const queued = clampCount(r.queued);
      const paused = r.paused === true;
      const cooldownMs = normalizeCooldown(r.cooldownMs);
      const autoReduced = r.autoReduced === true;
      // Build immutably (the contract fields are readonly): start with the always-
      // present fields, then layer the optional `pausedUntil` (finite number only)
      // + the auto-reduce-only `autoReducedFrom`/`notice` (present only when true).
      let entry: ConcurrencyStatusEntry = {
        providerId,
        limit,
        inFlight,
        queued,
        paused,
        cooldownMs,
        autoReduced,
      };
      if (typeof r.pausedUntil === "number" && Number.isFinite(r.pausedUntil)) {
        entry = { ...entry, pausedUntil: r.pausedUntil };
      }
      if (autoReduced) {
        // Accumulate the auto-reduce-only optionals into a plain record (the
        // contract fields are readonly, so we can't mutate a typed partial —
        // collect then spread into a fresh entry).
        const patch: { autoReducedFrom?: number; notice?: string } = {};
        if (typeof r.autoReducedFrom === "number" && Number.isFinite(r.autoReducedFrom)) {
          patch.autoReducedFrom = normalizeLimit(r.autoReducedFrom);
        }
        if (typeof r.notice === "string" && r.notice.length > 0) {
          patch.notice = r.notice;
        }
        if (patch.autoReducedFrom !== undefined || patch.notice !== undefined) {
          entry = { ...entry, ...patch };
        }
      }
      return entry;
    })
    .filter((r) => r.providerId !== "");
}

/**
 * Coerce an untrusted `GET`/`PUT /concurrency/cooldown/:providerId` body into a
 * typed cooldown response, or `null` when it is malformed (missing/malformed
 * `providerId` or `cooldownMs`). The composition root surfaces a 404/400/503 as
 * `ok: false` separately; this only defends the success body.
 */
export function normalizeConcurrencyCooldown(data: unknown): ConcurrencyCooldownResponse | null {
  if (!isRecord(data)) return null;
  const providerId = asString(data.providerId);
  if (providerId === null) return null;
  return { providerId, cooldownMs: normalizeCooldown(data.cooldownMs) };
}
