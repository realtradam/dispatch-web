import type { ActionRef, SurfaceOption } from "@dispatch/ui-contract";

/** Normalised view-model for a toggle field. */
export interface ToggleFieldView {
	readonly kind: "toggle";
	readonly label: string;
	readonly value: boolean;
	readonly action: ActionRef;
}

/** Normalised view-model for a progress field. */
export interface ProgressFieldView {
	readonly kind: "progress";
	readonly label: string;
	readonly value: number;
}

/** Normalised view-model for a selector field. */
export interface SelectorFieldView {
	readonly kind: "selector";
	readonly label: string;
	readonly value: string;
	readonly options: readonly SurfaceOption[];
	readonly action: ActionRef;
}

/** Normalised view-model for a stat field. */
export interface StatFieldView {
	readonly kind: "stat";
	readonly label: string;
	readonly value: string;
}

/** Normalised view-model for a button field. */
export interface ButtonFieldView {
	readonly kind: "button";
	readonly label: string;
	readonly action: ActionRef;
}

/** A normalised field view-model — one entry per renderable field kind. */
export type FieldView =
	| ToggleFieldView
	| ProgressFieldView
	| SelectorFieldView
	| StatFieldView
	| ButtonFieldView;

/** The output of `planSurface`: the ordered list of renderable fields. */
export interface SurfaceRenderPlan {
	readonly fields: readonly FieldView[];
}
