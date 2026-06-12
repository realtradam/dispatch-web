// Injected shell for smart-scroll: binds a real scrollable element to the pure
// reducer (logic/smart-scroll). It owns the reactive `showButton` flag (a thin
// rune wrapper over the reducer state), runs the scroll COMMANDS the reducer
// emits against the element, and listens at the outermost edges (the element's
// `scroll`/`scrollend` events + a ResizeObserver on the content). No ambient
// state: the consumer instantiates ONE controller per scroll region and disposes
// it on unmount.

import {
	createSmartScrollState,
	onContentChange,
	onReset,
	onResume,
	onScroll,
	type ScrollCommand,
	type ScrollGeometry,
	type SmartScrollResult,
	type SmartScrollState,
} from "../logic/smart-scroll";

export interface SmartScrollController {
	/** Reactive: show the "scroll to bottom" affordance (the user has scrolled up). */
	readonly showButton: boolean;
	/**
	 * Non-reactive point-in-time query: is the view stuck to the bottom right now?
	 * For imperative callers (e.g. the chat-limit unload gate) that poll at event
	 * time rather than subscribing — reads the reducer state, not a rune.
	 */
	isAtBottom(): boolean;
	/**
	 * Attach to the scroll container; returns a teardown to call on unmount.
	 * Pass the inner CONTENT element to also follow height changes that aren't a
	 * transcript update (async markdown/highlight, image loads, a collapse toggling,
	 * viewport reflow) via a ResizeObserver.
	 */
	attach(el: HTMLElement, content?: HTMLElement): () => void;
	/**
	 * Notify that the transcript content changed (a streamed delta / new message).
	 * While stuck, keeps the view pinned to the bottom.
	 */
	contentChanged(): void;
	/** Reset for a new transcript context (e.g. conversation switch): snap to bottom. */
	reset(): void;
	/** The user clicked the affordance: re-stick and smooth-scroll to the bottom. */
	resume(): void;
}

function geometryOf(el: HTMLElement): ScrollGeometry {
	return {
		scrollTop: el.scrollTop,
		scrollHeight: el.scrollHeight,
		clientHeight: el.clientHeight,
	};
}

export function createSmartScrollController(): SmartScrollController {
	let state: SmartScrollState = createSmartScrollState();
	let showButton = $state(false);
	let el: HTMLElement | null = null;
	// True while WE drive a programmatic scroll, so the resulting `scroll` event
	// doesn't get misread as the user scrolling up. Cleared on `scrollend`.
	let selfScrolling = false;

	function run(command: ScrollCommand | null): void {
		if (!command || !el) return;
		selfScrolling = true;
		el.scrollTo({
			top: el.scrollHeight,
			behavior: command.animate ? "smooth" : "instant",
		});
	}

	function apply(r: SmartScrollResult): void {
		state = r.state;
		showButton = r.showButton;
		run(r.command);
	}

	function handleScroll(): void {
		if (!el || selfScrolling) return;
		apply(onScroll(state, geometryOf(el)));
	}

	function handleScrollEnd(): void {
		selfScrolling = false;
	}

	return {
		get showButton(): boolean {
			return showButton;
		},

		isAtBottom(): boolean {
			return state.stuck;
		},

		attach(node: HTMLElement, content?: HTMLElement): () => void {
			el = node;
			node.addEventListener("scroll", handleScroll, { passive: true });
			node.addEventListener("scrollend", handleScrollEnd);

			// A ResizeObserver keeps the view pinned through height changes that are
			// NOT a transcript update — async markdown/syntax-highlight, image loads, a
			// collapse toggling, font swaps, viewport reflow — which a content-count
			// signal can't see. Observe the CONTENT (it grows) and the container (it
			// changes on viewport resize). Routed through `onContentChange`, so it only
			// scrolls while stuck and never fights the reader. The `selfScrolling` guard
			// (and the fact that scrolling doesn't resize content) prevents any loop.
			let ro: ResizeObserver | null = null;
			if (typeof ResizeObserver !== "undefined") {
				ro = new ResizeObserver(() => {
					if (!el || selfScrolling) return;
					apply(onContentChange(state, geometryOf(el)));
				});
				if (content) ro.observe(content);
				ro.observe(node);
			}

			return () => {
				node.removeEventListener("scroll", handleScroll);
				node.removeEventListener("scrollend", handleScrollEnd);
				ro?.disconnect();
				if (el === node) el = null;
			};
		},

		contentChanged(): void {
			if (!el) return;
			apply(onContentChange(state, geometryOf(el)));
		},

		reset(): void {
			apply(onReset());
		},

		resume(): void {
			apply(onResume(state));
		},
	};
}
