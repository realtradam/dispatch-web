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

/**
 * Normalised view-model for a number field — the free-value counterpart to
 * selector. `min`/`max`/`step`/`unit` are optional semantic hints (absent when
 * the spec omits them). The renderer posts the new number as the action payload.
 */
export interface NumberFieldView {
	readonly kind: "number";
	readonly label: string;
	readonly value: number;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly unit?: string;
	readonly action: ActionRef;
}

/** Normalised view-model for a button field. */
export interface ButtonFieldView {
	readonly kind: "button";
	readonly label: string;
	readonly action: ActionRef;
}

/**
 * Normalised view-model for a custom (escape-hatch) field. The plan carries it
 * through verbatim; the renderer dispatches on `rendererId` (a renderer KIND,
 * never a surface id) and gracefully skips ids it has no renderer for.
 */
export interface CustomFieldView {
	readonly kind: "custom";
	readonly rendererId: string;
	readonly payload: unknown;
}

/** A normalised field view-model — one entry per renderable field kind. */
export type FieldView =
	| ToggleFieldView
	| ProgressFieldView
	| SelectorFieldView
	| StatFieldView
	| NumberFieldView
	| ButtonFieldView
	| CustomFieldView;

/** The output of `planSurface`: the ordered list of renderable fields. */
export interface SurfaceRenderPlan {
	readonly fields: readonly FieldView[];
}

/**
 * A render group: a maximal run of consecutive `stat` fields (rendered together
 * as one aligned label/value table), or a single non-stat field. Grouping is a
 * GENERIC presentation rule keyed on field kind — it never inspects a surface id.
 */
export type RenderGroup =
	| { readonly type: "stats"; readonly stats: readonly StatFieldView[] }
	| { readonly type: "field"; readonly field: Exclude<FieldView, StatFieldView> };
