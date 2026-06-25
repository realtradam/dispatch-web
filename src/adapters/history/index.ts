/**
 * History adapter — the injected browser effect for client-side routing.
 *
 * A thin wrapper over `window.history` + the `popstate` event that exposes the
 * current pathname, a `navigate` (pushState) that updates the URL without a
 * reload, and a `subscribe` for path changes (back/forward buttons + programmatic
 * navigation). The route SEMANTICS (path → workspace/home) live in the
 * `workspaces` feature's pure `parsePath`; this adapter deals only in path
 * strings, so it stays generic + reusable.
 *
 * The browser edge (`window`/`history`) is INJECTED (defaults to the global) so
 * it is testable without the DOM and degrades to a no-op when absent (SSR / no
 * `window`).
 */

/** The minimal browser-history surface this adapter needs. */
export interface HistoryWindow {
	readonly location: { readonly pathname: string };
	readonly history: {
		pushState(data: unknown, unused: string, url?: string | URL | null): void;
		replaceState(data: unknown, unused: string, url?: string | URL | null): void;
	};
	addEventListener(type: "popstate", listener: () => void): void;
	removeEventListener(type: "popstate", listener: () => void): void;
}

export interface HistoryAdapter {
	/** The current pathname. */
	readonly path: string;
	/** Push a new path (updates the URL without a reload) + notifies subscribers. */
	navigate(path: string): void;
	/** Replace the current path without adding a history entry (no notify). */
	replace(path: string): void;
	/** Subscribe to path changes (back/forward + navigate). Returns unsubscribe. */
	subscribe(cb: (path: string) => void): () => void;
}

export interface CreateHistoryOptions {
	/** The browser window; defaults to `globalThis`. Inject for tests. */
	readonly window?: HistoryWindow;
}

function noop(): void {}

/** A no-op adapter for when there is no `window` (SSR). */
function createNoopHistory(): HistoryAdapter {
	return {
		get path() {
			return "/";
		},
		navigate: noop,
		replace: noop,
		subscribe() {
			return noop;
		},
	};
}

export function createHistoryAdapter(opts?: CreateHistoryOptions): HistoryAdapter {
	const w = opts?.window ?? (globalThis as unknown as HistoryWindow);
	if (w === undefined || w === null || w.location === undefined) {
		return createNoopHistory();
	}

	const listeners = new Set<(path: string) => void>();
	const current = (): string => w.location.pathname;
	const emit = (): void => {
		const p = current();
		for (const cb of listeners) cb(p);
	};

	return {
		get path() {
			return current();
		},
		navigate(path: string): void {
			w.history.pushState(null, "", path);
			emit();
		},
		replace(path: string): void {
			w.history.replaceState(null, "", path);
		},
		subscribe(cb: (path: string) => void): () => void {
			listeners.add(cb);
			const onPop = (): void => cb(current());
			w.addEventListener("popstate", onPop);
			return () => {
				listeners.delete(cb);
				w.removeEventListener("popstate", onPop);
			};
		},
	};
}
