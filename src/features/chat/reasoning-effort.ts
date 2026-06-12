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

/** One `<option>` of the selector. */
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
