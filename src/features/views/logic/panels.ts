/**
 * Pure reducer for the view sidebar's panel stack.
 *
 * A "view" is the RESERVED Dispatch sidebar affordance (see GLOSSARY): the user
 * stacks panels, each showing one view KIND chosen from a dropdown, and adds
 * more with a `+` button. This module is the pure model — zero DOM, zero Svelte.
 * The component (`ViewSidebar.svelte`) is a thin runes wrapper over it.
 *
 * `id` is a per-session stable key for `{#each}` only; it is never persisted.
 */

export interface ViewPanel {
	readonly id: number;
	/** Selected view-kind id, or `null` while the panel still reads "Select a view". */
	readonly kind: string | null;
}

export interface PanelsState {
	readonly panels: readonly ViewPanel[];
	readonly nextId: number;
}

/**
 * Seed state. Each entry becomes one panel in order; pass `["surfaces"]` to open
 * a single preset panel, or `[null]` for one empty "Select a view" panel.
 */
export function initialPanels(kinds: readonly (string | null)[] = [null]): PanelsState {
	let nextId = 0;
	const panels = kinds.map((kind) => ({ id: nextId++, kind }));
	return { panels, nextId };
}

export function addPanel(state: PanelsState, kind: string | null = null): PanelsState {
	return {
		panels: [...state.panels, { id: state.nextId, kind }],
		nextId: state.nextId + 1,
	};
}

export function removePanel(state: PanelsState, id: number): PanelsState {
	return { ...state, panels: state.panels.filter((p) => p.id !== id) };
}

export function selectKind(state: PanelsState, id: number, kind: string | null): PanelsState {
	return {
		...state,
		panels: state.panels.map((p) => (p.id === id ? { ...p, kind } : p)),
	};
}
