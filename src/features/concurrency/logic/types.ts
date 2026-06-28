import type {
  ConcurrencyCooldownResponse,
  ConcurrencyLimitResponse,
  ConcurrencyLimitsResponse,
  ConcurrencyStatusEntry,
  ConcurrencyStatusResponse,
  SetConcurrencyCooldownRequest,
  SetConcurrencyLimitRequest,
} from "@dispatch/transport-contract";

/**
 * Pure core types for the concurrency feature — zero DOM, zero effects, zero
 * Svelte.
 *
 * The backend tracks + limits how many concurrent token-generating API requests
 * are in flight PER PROVIDER. When the cap is reached, additional requests queue
 * and are granted slots oldest-agent-first; a 429 backoff PAUSES a provider's
 * queue until `pausedUntil`. The cap is in-memory + per-provider (no persistence),
 * managed via a plain REST surface under `/concurrency/...` provided by the
 * `concurrency` extension. When the extension isn't loaded, the list + status
 * endpoints return empty arrays (`{ limits: [] }` / `{ providers: [] }`); the
 * single / PUT / DELETE endpoints return `503`.
 *
 * The data shapes ARE part of `@dispatch/transport-contract` (0.23.0), so they
 * are imported directly (mirrors `mcp` / `computer`). The result types + injected
 * ports below are FE-owned (the composition root adapts the store's HTTP calls to
 * them). The endpoints are GLOBAL (not workspace- or conversation-scoped).
 *
 * Concurrency-fixes (additive, no version bump): each `ConcurrencyStatusEntry`
 * now also carries `cooldownMs` (per-slot release cooldown, configurable +
 * persisted), `autoReduced` (a 429 auto-reduced the limit by 1, one-way), and
 * when auto-reduced, `autoReducedFrom` + a `notice` banner string. A manual
 * `PUT /concurrency/limits/:providerId` clears `autoReduced`. Two new endpoints
 * `GET`/`PUT /concurrency/cooldown/:providerId` view/change the cooldown.
 */

/** Re-export the contract shapes so consumers import a single surface. */
export type {
  ConcurrencyCooldownResponse,
  ConcurrencyLimitResponse,
  ConcurrencyLimitsResponse,
  ConcurrencyStatusEntry,
  ConcurrencyStatusResponse,
  SetConcurrencyCooldownRequest,
  SetConcurrencyLimitRequest,
};

/**
 * A configured concurrency limit — one provider's cap on in-flight requests.
 * Same shape as the contract's `ConcurrencyLimitResponse`.
 */
export interface ConcurrencyLimitEntry {
  readonly providerId: string;
  readonly limit: number;
}

// ── Result types (port outcomes; the store returns these directly) ──────────────

/** Outcome of `GET /concurrency/limits` (all configured limits). */
export type ConcurrencyLimitsResult =
  | { readonly ok: true; readonly limits: readonly ConcurrencyLimitEntry[] }
  | { readonly ok: false; readonly error: string };

/**
 * Outcome of `GET`/`PUT /concurrency/limits/:providerId` — the configured limit
 * for one provider. `GET` returns `404` when the provider has no limit (surfaced
 * as `ok: false`); `PUT` returns `400` for a non-positive-integer body.
 */
export type ConcurrencyLimitResult =
  | { readonly ok: true; readonly providerId: string; readonly limit: number }
  | { readonly ok: false; readonly error: string };

/** Outcome of `DELETE /concurrency/limits/:providerId` (remove → unlimited). */
export type ConcurrencyDeleteResult =
  | { readonly ok: true; readonly providerId: string }
  | { readonly ok: false; readonly error: string };

/** Outcome of `GET /concurrency/status` (live status for every limited provider). */
export type ConcurrencyStatusResult =
  | { readonly ok: true; readonly providers: readonly ConcurrencyStatusEntry[] }
  | { readonly ok: false; readonly error: string };

/**
 * Outcome of `GET`/`PUT /concurrency/cooldown/:providerId` — the per-slot
 * release cooldown (ms) for one provider. `GET` returns `404` when the provider
 * has no concurrency config at all (no limit, no cooldown); `PUT` returns `400`
 * for a non-negative-integer body. Both return `503` when the extension isn't
 * loaded.
 */
export type ConcurrencyCooldownResult =
  | { readonly ok: true; readonly providerId: string; readonly cooldownMs: number }
  | { readonly ok: false; readonly error: string };

/**
 * Outcome of an auto-reduce banner's "Restore to N" action (PUT the limit back
 * to `autoReducedFrom` via `PUT /concurrency/limits/:providerId`). Carried back to
 * the banner so a FAILED restore surfaces an inline error next to the button
 * (instead of silently re-enabling the button / showing the error far away).
 */
export type RestoreOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

// ── Injected ports (consumer-defines-port; the composition root adapts the
//    store's HTTP calls to these shapes). ──────────────────────────────────────

export type LoadConcurrencyLimits = () => Promise<ConcurrencyLimitsResult>;
export type GetConcurrencyLimit = (providerId: string) => Promise<ConcurrencyLimitResult>;
export type SaveConcurrencyLimit = (
  providerId: string,
  limit: number,
) => Promise<ConcurrencyLimitResult>;
export type DeleteConcurrencyLimit = (providerId: string) => Promise<ConcurrencyDeleteResult>;
export type LoadConcurrencyStatus = () => Promise<ConcurrencyStatusResult>;
/** `GET /concurrency/cooldown/:providerId` — read the per-slot release cooldown. */
export type GetConcurrencyCooldown = (providerId: string) => Promise<ConcurrencyCooldownResult>;
/** `PUT /concurrency/cooldown/:providerId` — set the per-slot release cooldown (non-negative int). */
export type SaveConcurrencyCooldown = (
  providerId: string,
  cooldownMs: number,
) => Promise<ConcurrencyCooldownResult>;
