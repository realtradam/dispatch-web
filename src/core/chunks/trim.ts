// Chat-limit windowing for the transcript — PURE policy, zero DOM/Svelte.
//
// In very long conversations an unbounded transcript makes the browser crawl, so
// the FE keeps at most `chat limit` chunks loaded and UNLOADS the oldest ones in
// BULK: a quarter of the limit at a time (limit 100 → at 101 chunks it unloads 25,
// leaving 76). Bulk-on-threshold — NOT one-per-delta like old Dispatch — so a trim
// happens once per ~quarter-limit of new content instead of on every step, which
// was the old scroll-jump-per-step failure mode. A fresh page load shows only the
// newest `floor(0.75 × limit)` chunks, leaving headroom before the first trim.
//
// Unloading drops COMMITTED chunks only (provisional chunks are the in-flight
// turn; they become committed at seal and trimmable then) and records the
// `hiddenBeforeSeq` watermark so history merges can't resurrect them and the
// "Show earlier messages" affordance knows where to page back in from.

import type { StoredChunk } from "@dispatch/wire";
import type { TranscriptState } from "./types";

/** Default chat limit (max loaded chunks per conversation). */
export const DEFAULT_CHAT_LIMIT = 256;
/** Hard floor for a configured chat limit (a tiny window would thrash). */
export const MIN_CHAT_LIMIT = 10;
/** Hard ceiling for a configured chat limit. */
export const MAX_CHAT_LIMIT = 100_000;

/**
 * Normalize an untrusted configured limit (e.g. parsed from localStorage):
 * non-numeric/NaN → the default; otherwise floored + clamped to
 * [MIN_CHAT_LIMIT, MAX_CHAT_LIMIT].
 */
export function normalizeChatLimit(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CHAT_LIMIT;
	const n = Math.floor(value);
	if (n < MIN_CHAT_LIMIT) return MIN_CHAT_LIMIT;
	if (n > MAX_CHAT_LIMIT) return MAX_CHAT_LIMIT;
	return n;
}

/** The bulk-unload unit: a quarter of the limit, rounded up. */
export function unloadCount(limit: number): number {
	return Math.ceil(limit / 4);
}

/** The fresh-load window: 75% of the limit, rounded down (≥ 1). */
export function initialWindowSize(limit: number): number {
	return Math.max(1, Math.floor(limit * 0.75));
}

/** Total loaded (rendered) chunk count: committed + provisional + accumulating. */
function totalCount(state: TranscriptState): number {
	return state.committed.length + state.provisional.length + (state.accumulating !== null ? 1 : 0);
}

function countThinking(chunks: readonly StoredChunk[]): number {
	let n = 0;
	for (const c of chunks) {
		if (c.chunk.type === "thinking") n++;
	}
	return n;
}

/** Drop the `drop` oldest committed chunks, advancing the watermark + thinking base. */
function dropOldest(state: TranscriptState, drop: number): TranscriptState {
	const dropped = state.committed.slice(0, drop);
	const kept = state.committed.slice(drop);
	const first = kept[0];
	const lastDropped = dropped[dropped.length - 1];
	let hiddenBeforeSeq = state.hiddenBeforeSeq;
	if (first !== undefined) {
		hiddenBeforeSeq = first.seq;
	} else if (lastDropped !== undefined) {
		hiddenBeforeSeq = lastDropped.seq + 1;
	}
	return {
		...state,
		committed: kept,
		hiddenBeforeSeq,
		hiddenThinkingCount: state.hiddenThinkingCount + countThinking(dropped),
	};
}

/**
 * Enforce the chat limit: when the loaded count EXCEEDS `limit`, unload whole
 * quarters (`unloadCount(limit)` each) of the OLDEST committed chunks until back
 * at/under the limit — normally exactly one quarter (limit 100: 101 → 76); more
 * only when trimming was deferred (e.g. while the reader was scrolled up).
 * At/under the limit this is the identity. Never drops provisional chunks.
 */
export function trimTranscript(state: TranscriptState, limit: number): TranscriptState {
	if (!Number.isFinite(limit) || limit <= 0) return state;
	const total = totalCount(state);
	if (total <= limit) return state;
	const quarter = unloadCount(limit);
	const passes = Math.ceil((total - limit) / quarter);
	const drop = Math.min(passes * quarter, state.committed.length);
	if (drop <= 0) return state;
	return dropOldest(state, drop);
}

/**
 * Window the committed history down to the newest `maxCommitted` chunks (the
 * fresh-load path: `maxCommitted = initialWindowSize(limit)`). Identity when
 * already within the window.
 */
export function windowTranscript(state: TranscriptState, maxCommitted: number): TranscriptState {
	if (!Number.isFinite(maxCommitted) || maxCommitted < 0) return state;
	const drop = state.committed.length - maxCommitted;
	if (drop <= 0) return state;
	return dropOldest(state, drop);
}

/**
 * The oldest LOADED seq — the start of the transcript's loaded window. Usually
 * `committed[0].seq`; falls back to the watermark when a trim emptied the
 * committed list (all-provisional overflow). 0 = window start unknown/origin.
 */
function oldestLoadedSeq(state: TranscriptState): number {
	return state.committed[0]?.seq ?? state.hiddenBeforeSeq;
}

/**
 * Page earlier history back in — the "Show earlier messages" action.
 *
 * `earlier` is every locally-known chunk older than the loaded window
 * (typically the full cached conversation, possibly extended by a CR-5
 * `?beforeSeq=` backfill; chunks at/inside the window are ignored). The newest
 * `count` of them are merged back in front of `committed`, and the watermark
 * follows the new window start so history merges still can't resurrect what
 * remains unloaded. Identity when the window already starts at seq 1 (the
 * contractual origin) or nothing older is known locally.
 */
export function restoreEarlier(
	state: TranscriptState,
	earlier: readonly StoredChunk[],
	count: number,
): TranscriptState {
	const oldest = oldestLoadedSeq(state);
	if (oldest <= 1) return state;
	const below = earlier.filter((c) => c.seq < oldest).sort((a, b) => a.seq - b.seq);
	if (below.length === 0) return state;
	const keep = below.slice(-Math.max(1, count));
	const firstKept = keep[0];
	return {
		...state,
		committed: [...keep, ...state.committed],
		hiddenBeforeSeq: firstKept?.seq ?? state.hiddenBeforeSeq,
		hiddenThinkingCount: Math.max(0, state.hiddenThinkingCount - countThinking(keep)),
	};
}

/**
 * Whether earlier history exists below the loaded window — drives the
 * "Show earlier messages" affordance. Derived from the wire@0.6.1 CONTRACT
 * that per-conversation seqs are 1-based and gap-free: a loaded window that
 * starts above seq 1 means older chunks exist (locally cached or server-side),
 * whether the window came from a local trim or a server-windowed (`?limit=`)
 * fresh load.
 */
export function selectHasEarlier(state: TranscriptState): boolean {
	return oldestLoadedSeq(state) > 1;
}
