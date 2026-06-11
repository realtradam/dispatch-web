import type { SurfaceSpec } from "@dispatch/ui-contract";

/**
 * Pure core for the cache-warming view — zero DOM, zero effects, zero Svelte.
 *
 * The backend's `cache-warming` surface carries a toggle, a number interval (in
 * seconds), two `stat`s ("last cache rate" + "cache retention"), and a `custom`
 * `cache-warming-timer` field bearing the AUTHORITATIVE `nextWarmAt`/`lastWarmAt`
 * epoch-ms timestamps. This module turns those inputs into the view-model the
 * (thin) Svelte component renders: parsed controls, a warming-history reducer
 * keyed off the authoritative `lastWarmAt`, an authoritative countdown, and the
 * status/format helpers.
 */

// ── Manual-warm port (consumer-defines-port; the composition root adapts the
//    store's `POST /chat/warm` result to this shape). ──────────────────────────
export type WarmFeedback =
	| { readonly ok: true; readonly cachePct: number; readonly expectedCacheRate: number }
	| { readonly ok: false; readonly error: string };

export type WarmNow = () => Promise<WarmFeedback | null>;

// ── Parsed surface controls ───────────────────────────────────────────────────

export interface ParsedControls {
	readonly enabled: boolean;
	readonly toggleActionId: string | null;
	readonly intervalSeconds: number;
	readonly setIntervalActionId: string | null;
	/** Most recent warm's cache-hit %, from the "last cache rate" stat (`null` when "—"/absent). */
	readonly lastPct: number | null;
	/** Cross-turn retention %, from the "cache retention" stat (`null` when "—"/absent). */
	readonly retentionPct: number | null;
	/** Authoritative epoch-ms the next AUTOMATIC warm fires, or `null` when not scheduled. */
	readonly nextWarmAt: number | null;
	/** Authoritative epoch-ms of the most recent completed warm, or `null` if none. */
	readonly lastWarmAt: number | null;
}

const EMPTY_CONTROLS: ParsedControls = {
	enabled: false,
	toggleActionId: null,
	intervalSeconds: 0,
	setIntervalActionId: null,
	lastPct: null,
	retentionPct: null,
	nextWarmAt: null,
	lastWarmAt: null,
};

/** The `cache-warming-timer` custom field's renderer id (this feature owns it). */
const TIMER_RENDERER_ID = "cache-warming-timer";

/** Parse a stat's display string (e.g. "100%", "93 %", "—") into a number or null. */
export function parsePct(value: string): number | null {
	const match = value.match(/-?\d+(?:\.\d+)?/);
	if (match === null) return null;
	const n = Number(match[0]);
	return Number.isFinite(n) ? n : null;
}

/** A finite number, else null. */
function numOrNull(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Pull the authoritative `nextWarmAt`/`lastWarmAt` out of the timer custom payload. */
function parseTimer(payload: unknown): { nextWarmAt: number | null; lastWarmAt: number | null } {
	if (typeof payload !== "object" || payload === null) {
		return { nextWarmAt: null, lastWarmAt: null };
	}
	const p = payload as Record<string, unknown>;
	return { nextWarmAt: numOrNull(p.nextWarmAt), lastWarmAt: numOrNull(p.lastWarmAt) };
}

/**
 * Extract the cache-warming controls from the surface spec by FIELD KIND. The
 * surface has one toggle, one number, two stats (rate + retention, told apart by
 * label), and one `custom` timer field. Returns empty defaults when the spec is
 * absent.
 */
export function parseControls(spec: SurfaceSpec | null): ParsedControls {
	if (spec === null) return EMPTY_CONTROLS;
	let enabled = false;
	let toggleActionId: string | null = null;
	let intervalSeconds = 0;
	let setIntervalActionId: string | null = null;
	let lastPct: number | null = null;
	let retentionPct: number | null = null;
	let nextWarmAt: number | null = null;
	let lastWarmAt: number | null = null;
	let seenToggle = false;
	let seenNumber = false;
	let seenRateStat = false;
	for (const field of spec.fields) {
		if (field.kind === "toggle" && !seenToggle) {
			enabled = field.value;
			toggleActionId = field.action.actionId;
			seenToggle = true;
		} else if (field.kind === "number" && !seenNumber) {
			intervalSeconds = field.value;
			setIntervalActionId = field.action.actionId;
			seenNumber = true;
		} else if (field.kind === "stat") {
			// Retention is told apart by its label; everything else is the cache rate
			// (first one wins, so a stray later stat can't clobber it).
			if (/retention/i.test(field.label)) {
				retentionPct = parsePct(field.value);
			} else if (!seenRateStat) {
				lastPct = parsePct(field.value);
				seenRateStat = true;
			}
		} else if (field.kind === "custom" && field.rendererId === TIMER_RENDERER_ID) {
			const timer = parseTimer(field.payload);
			nextWarmAt = timer.nextWarmAt;
			lastWarmAt = timer.lastWarmAt;
		}
	}
	return {
		enabled,
		toggleActionId,
		intervalSeconds,
		setIntervalActionId,
		lastPct,
		retentionPct,
		nextWarmAt,
		lastWarmAt,
	};
}

// ── Interval ↔ minutes/seconds (seconds capped at 59) ─────────────────────────

export interface MinSec {
	readonly minutes: number;
	readonly seconds: number;
}

export function clampSeconds(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.min(59, Math.max(0, Math.floor(n)));
}

export function clampMinutes(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.floor(n));
}

export function toMinSec(totalSeconds: number): MinSec {
	const total = Math.max(0, Math.floor(totalSeconds));
	return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/** Combine a minutes + seconds pair (each clamped) into total seconds. */
export function fromMinSec(minutes: number, seconds: number): number {
	return clampMinutes(minutes) * 60 + clampSeconds(seconds);
}

// ── Status + formatting ───────────────────────────────────────────────────────

export type WarmStatus = "success" | "warning" | "error";

/** Cache-hit % → semantic status (green high, yellow mid, red low). */
export function statusForPct(pct: number): WarmStatus {
	if (pct >= 80) return "success";
	if (pct >= 40) return "warning";
	return "error";
}

/** A status → its DaisyUI text-colour class (full literal so Tailwind keeps it). */
export function colorClass(status: WarmStatus): string {
	switch (status) {
		case "success":
			return "text-success";
		case "warning":
			return "text-warning";
		case "error":
			return "text-error";
	}
}

/** The status line for a warm, matching the manual-warm feedback phrasing. */
export function formatWarmLabel(pct: number): string {
	return `Warmed — ${Math.round(pct)}% cache hit`;
}

/** Seconds → a short countdown string (e.g. "3:05", "9s"). */
export function formatCountdown(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	return `${m}:${String(rem).padStart(2, "0")}`;
}

// ── Warming history reducer (keyed off the authoritative `lastWarmAt`) ─────────

export interface WarmEntry {
	readonly pct: number;
	/** Authoritative epoch-ms of this warm (the surface's `lastWarmAt`). */
	readonly at: number;
}

export interface WarmingViewState {
	/** Warmings, MOST RECENT FIRST. */
	readonly history: readonly WarmEntry[];
	/** The last authoritative `lastWarmAt` recorded, for change-detection (de-dup key). */
	readonly lastWarmAt: number | null;
}

const MAX_HISTORY = 50;

export function initialWarmingState(): WarmingViewState {
	return { history: [], lastWarmAt: null };
}

/**
 * Fold the surface's authoritative `lastWarmAt` + current "last cache rate" into
 * history. Records a new entry only when `lastWarmAt` CHANGED (a toggle/interval
 * update re-pushes the same timestamp → no entry), de-duplicated on the timestamp
 * (not the pct, so two warms with the same % both count). A null `lastWarmAt` is
 * ignored; a null pct advances the de-dup key without adding an entry.
 */
export function observeWarm(
	state: WarmingViewState,
	lastWarmAt: number | null,
	pct: number | null,
): WarmingViewState {
	if (lastWarmAt === null || lastWarmAt === state.lastWarmAt) return state;
	if (pct === null) return { ...state, lastWarmAt };
	const history = [{ pct, at: lastWarmAt }, ...state.history].slice(0, MAX_HISTORY);
	return { history, lastWarmAt };
}

/**
 * Seconds until the next automatic warm, AUTHORITATIVE: derived straight from the
 * backend's `nextWarmAt` epoch-ms (never FE-anchored/guessed). `null` when nothing
 * is scheduled (disabled, or a turn is generating so the timer is cancelled).
 */
export function secondsUntilNext(nextWarmAt: number | null, now: number): number | null {
	if (nextWarmAt === null) return null;
	return Math.max(0, Math.ceil((nextWarmAt - now) / 1000));
}
