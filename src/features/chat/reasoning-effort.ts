import type { ReasoningEffort } from "@dispatch/transport-contract";

/**
 * Pure helpers for the reasoning-effort selector (the thinking-depth knob).
 *
 * The canonical ladder + resolution chain are SERVER-owned (`wire@0.7.0`
 * `ReasoningEffort`; per-turn override → persisted conversation value → default
 * `"high"`). These helpers only shape the persisted value for display: a `null`
 * from `GET /conversations/:id/reasoning-effort` means "never set ⇒ the default
 * applies", so the selector shows `high (default)` — never "off". Zero DOM,
 * zero Svelte.
 */

/** The canonical ladder, in ascending thinking-depth order (`wire@0.7.0`). */
export const REASONING_EFFORT_LEVELS: readonly ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** The server's fallback when nothing is set (the resolution chain's tail). */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

/** Narrow an untrusted string (e.g. a `<select>` value) to the ladder. */
export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * The level the selector should show as selected: the persisted value, or the
 * server default when never set (`null` = "default applies", not "off").
 */
export function effectiveEffort(persisted: ReasoningEffort | null): ReasoningEffort {
  return persisted ?? DEFAULT_REASONING_EFFORT;
}

/** One `<option>` of the effort ladder. */
export interface EffortOption {
  readonly value: ReasoningEffort;
  readonly label: string;
}

/**
 * The selector's options: every ladder level, with the server default marked
 * `(default)` so a never-set conversation reads "high (default)".
 */
export function effortOptions(): readonly EffortOption[] {
  return REASONING_EFFORT_LEVELS.map((level) => ({
    value: level,
    label: level === DEFAULT_REASONING_EFFORT ? `${level} (default)` : level,
  }));
}

// ── Injected port (consumer-defines-port; the composition root adapts the
//    store's `PUT /conversations/:id/reasoning-effort` to this shape). ────────

/** Outcome of `PUT /conversations/:id/reasoning-effort`. */
export type ReasoningEffortSaveResult =
  | { readonly ok: true; readonly reasoningEffort: ReasoningEffort }
  | { readonly ok: false; readonly error: string };

export type SaveReasoningEffort = (
  level: ReasoningEffort,
) => Promise<ReasoningEffortSaveResult | null>;

// ── Thinking on/off (a SEPARATE axis from the effort level) ─────────────────
//
// Per the umans API (and the user's mental model), "thinking off" is NOT a
// zero-effort level — it is a distinct "disable extended thinking entirely"
// signal. The umans route expresses it as `reasoning_effort: "none"`; Dispatch
// surfaces it as a SEPARATE per-conversation boolean so the effort LEVEL is
// preserved across an off→on toggle (turning thinking back on restores the
// previously-chosen depth). The per-conversation selector CONFLATES the two
// axes into one `<select>` (UX), but the WIRE keeps them separate.
//
// ⚠️ BACKEND CONTRACT GAP — see `backend-handoff.md`. The `thinking` endpoint +
// wire types below are the PROPOSED shape; the backend has NOT shipped them yet.
// They are defined FE-local (mirroring the shipped `ReasoningEffortResponse` /
// `SetReasoningEffortRequest` shape) so the FE is built + tested against the
// target contract. Re-pin + re-mirror once the backend ships them.

/**
 * Response of `GET /conversations/:id/thinking` (PROPOSED). `thinking` is null
 * when never set (the server then resolves turns with thinking ON — the
 * default), `false` when explicitly disabled, `true` when explicitly enabled.
 */
export interface ThinkingResponse {
  readonly conversationId: string;
  readonly thinking: boolean | null;
}

/** Body of `PUT /conversations/:id/thinking` (PROPOSED). */
export interface SetThinkingRequest {
  readonly thinking: boolean;
}

/**
 * The per-conversation selector's value: `"off"` (thinking disabled — the
 * separate axis) or a reasoning-effort LEVEL. NOT a widened ladder: `"off"` is
 * not a degree of effort, it is the absence of thinking.
 */
export type ThinkingSelection = "off" | ReasoningEffort;

/** One `<option>` of the combined selector (off or a level). */
export interface SelectionOption {
  readonly value: ThinkingSelection;
  readonly label: string;
}

/**
 * The selector's options: `"off"` first (the separate disable signal), then the
 * effort ladder with the server default marked `(default)`. A never-set
 * conversation (thinking on, effort null) reads "high (default)".
 */
export function selectionOptions(): readonly SelectionOption[] {
  return [{ value: "off", label: "Off" }, ...effortOptions()];
}

/** Narrow an untrusted `<select>` value to a {@link ThinkingSelection}. */
export function isThinkingSelection(value: string): value is ThinkingSelection {
  return value === "off" || isReasoningEffort(value);
}

/**
 * The selection the per-conversation selector should show as selected: `"off"`
 * when thinking is explicitly disabled (`persistedThinking === false`), else the
 * effective effort level. `persistedThinking === null` (never set) ⇒ thinking
 * ON (the default) ⇒ the effort level is shown — NOT "off".
 */
export function effectiveSelection(
  persistedEffort: ReasoningEffort | null,
  persistedThinking: boolean | null,
): ThinkingSelection {
  if (persistedThinking === false) return "off";
  return effectiveEffort(persistedEffort);
}

// ── Injected port for the combined selector (off OR a level) ─────────────────

/** Outcome of persisting a {@link ThinkingSelection} (one or two PUTs). */
export type ThinkingSelectionSaveResult =
  | { readonly ok: true; readonly selection: ThinkingSelection }
  | { readonly ok: false; readonly error: string };

/**
 * Persist a thinking selection (consumer-defines-port; the composition root
 * adapts the store's `PUT .../thinking` + `PUT .../reasoning-effort` to this).
 * - `"off"` → disable thinking (the separate signal); the effort level is left
 *   untouched so an off→on toggle restores it.
 * - a level → set the effort level AND ensure thinking is ON (the level is
 *   meaningless while thinking is off).
 */
export type SaveThinkingSelection = (
  selection: ThinkingSelection,
) => Promise<ThinkingSelectionSaveResult | null>;

/** Outcome of `PUT /conversations/:id/thinking`. */
export type ThinkingSaveResult =
  | { readonly ok: true; readonly thinking: boolean }
  | { readonly ok: false; readonly error: string };
