import type { TurnProviderRetryEvent } from "@dispatch/wire";

/**
 * Pure view-model for the transient `provider-retry` warning banner. Zero DOM,
 * zero effects, zero Svelte — mirrors the `core/metrics` view-models the chat UI
 * already imports. The banner state itself lives in `TranscriptState.providerRetry`
 * (set/cleared by `foldEvent`); this module only formats an event into render data.
 *
 * The "countdown" is a STATIC label derived from `delayMs` (e.g. "retrying in
 * 5s…"), matching the backend's examples — NOT a live ticking timer (which would
 * be a component effect and re-render churn). Each new `provider-retry` event
 * coalesces over the previous, so the banner always shows the newest attempt + delay.
 */

/** The display shape for a provider-retry banner. */
export interface ProviderRetryView {
  /** "Retry #N" — `attempt` is 0-based, so +1 (attempt 0 = "Retry #1"). */
  readonly attemptLabel: string;
  /** The scheduled sleep as a short duration: "5s" / "30s" / "1m" / "5m" / "30m". */
  readonly delayLabel: string;
  /** The endpoint's error verbatim, e.g. "HTTP 429: {…overloaded_error…}". */
  readonly message: string;
  /** The HTTP code when known (e.g. "429"), else null. */
  readonly code: string | null;
}

/**
 * Format a millisecond delay as a short, human-friendly duration. Matches the
 * backend's backoff schedule (5s→10s→30s→60s→5m→10m→15m→30m): under a minute
 * shows seconds, under an hour shows minutes, else hours.
 */
export function formatRetryDelay(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  return `${Math.round(totalMinutes / 60)}h`;
}

/**
 * Map a `provider-retry` event to its banner view. `attempt` is 0-based (the Nth
 * retry about to happen), so the label is 1-based for the user.
 */
export function viewProviderRetry(event: TurnProviderRetryEvent): ProviderRetryView {
  return {
    attemptLabel: `Retry #${event.attempt + 1}`,
    delayLabel: formatRetryDelay(event.delayMs),
    message: event.message,
    code: event.code ?? null,
  };
}
