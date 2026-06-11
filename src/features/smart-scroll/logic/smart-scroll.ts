// Pure smart-scroll reducer — "stick the transcript to the bottom while it grows,
// unless the user has scrolled up". Zero DOM, zero Svelte: it takes scroll
// GEOMETRY snapshots in and returns the next state plus an optional scroll
// COMMAND for the shell to execute. The injected shell (the Svelte action) reads
// the geometry off a real element and runs the commands.

/** A snapshot of a scroll container's vertical geometry (in CSS pixels). */
export interface ScrollGeometry {
	/** Current scroll offset from the top. */
	readonly scrollTop: number;
	/** Total scrollable content height. */
	readonly scrollHeight: number;
	/** Visible viewport height. */
	readonly clientHeight: number;
}

/** Distance (px) from the bottom within which we still consider the view "at bottom". */
export const NEAR_BOTTOM_THRESHOLD = 64;

/** True when the viewport is within `threshold` px of the content's bottom edge. */
export function isNearBottom(
	geom: ScrollGeometry,
	threshold: number = NEAR_BOTTOM_THRESHOLD,
): boolean {
	return geom.scrollHeight - geom.scrollTop - geom.clientHeight <= threshold;
}

/** A scroll the shell should perform on the real element. */
export interface ScrollCommand {
	readonly kind: "scroll-to-bottom";
	/** Smooth-scroll (a deliberate resume) vs. jump (keeping up with a stream). */
	readonly animate: boolean;
}

export interface SmartScrollState {
	/**
	 * Whether the view is currently following the bottom. While `stuck`, new
	 * content keeps the view pinned to the bottom; once the user scrolls up it
	 * goes false and stays false until they return to the bottom (or resume).
	 */
	readonly stuck: boolean;
}

/** A reducer step's result: the next state, an optional command, and whether to show the button. */
export interface SmartScrollResult {
	readonly state: SmartScrollState;
	readonly command: ScrollCommand | null;
	/** Show the "scroll to bottom" affordance exactly when not stuck. */
	readonly showButton: boolean;
}

/** Initial state — start stuck so the first content snaps to the bottom. */
export function createSmartScrollState(): SmartScrollState {
	return { stuck: true };
}

function result(state: SmartScrollState, command: ScrollCommand | null): SmartScrollResult {
	return { state, command, showButton: !state.stuck };
}

/**
 * The user scrolled (or the viewport resized). Re-derive `stuck` purely from
 * geometry: near the bottom ⇒ stuck (follow), otherwise unstuck. Never emits a
 * command — reacting to the user's own scroll with a scroll would fight them.
 */
export function onScroll(_state: SmartScrollState, geom: ScrollGeometry): SmartScrollResult {
	return result({ stuck: isNearBottom(geom) }, null);
}

/**
 * Content changed (a streamed delta, a new message, history loaded). If we're
 * stuck, emit a non-animated scroll to keep up; otherwise leave the user where
 * they are. State is unchanged — content growth alone never flips `stuck`.
 */
export function onContentChange(state: SmartScrollState, _geom: ScrollGeometry): SmartScrollResult {
	return result(state, state.stuck ? { kind: "scroll-to-bottom", animate: false } : null);
}

/**
 * The user asked to return to the bottom (clicked the button). Force-stick and
 * emit an animated scroll.
 */
export function onResume(_state: SmartScrollState): SmartScrollResult {
	return result({ stuck: true }, { kind: "scroll-to-bottom", animate: true });
}

/**
 * The transcript context changed entirely (e.g. a conversation/tab switch).
 * Reset to stuck and snap (non-animated) to the bottom of the new content.
 */
export function onReset(): SmartScrollResult {
	return result(createSmartScrollState(), { kind: "scroll-to-bottom", animate: false });
}
