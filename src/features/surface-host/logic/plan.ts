import type { InvokeMessage, SurfaceSpec } from "@dispatch/ui-contract";
import type {
	FieldView,
	NumberFieldView,
	RenderGroup,
	StatFieldView,
	SurfaceRenderPlan,
} from "./types";

const KNOWN_KINDS = new Set([
	"toggle",
	"progress",
	"selector",
	"stat",
	"number",
	"button",
	"custom",
]);

/**
 * Validate and normalise a SurfaceSpec into a renderable plan.
 * Keeps known field kinds in order (including `custom`, carried through verbatim
 * for the renderer to dispatch on `rendererId`); drops unknown kinds — graceful
 * skip, never throw. Whether a `custom` field actually renders is a RENDER-time
 * decision (unknown `rendererId` → skipped there), not a planning one.
 */
export function planSurface(spec: SurfaceSpec): SurfaceRenderPlan {
	const fields: FieldView[] = [];
	for (const field of spec.fields) {
		if (!KNOWN_KINDS.has(field.kind)) continue;
		switch (field.kind) {
			case "toggle":
				fields.push({
					kind: "toggle",
					label: field.label,
					value: field.value,
					action: field.action,
				});
				break;
			case "progress":
				fields.push({
					kind: "progress",
					label: field.label,
					value: field.value,
				});
				break;
			case "selector":
				fields.push({
					kind: "selector",
					label: field.label,
					value: field.value,
					options: field.options,
					action: field.action,
				});
				break;
			case "stat":
				fields.push({
					kind: "stat",
					label: field.label,
					value: field.value,
				});
				break;
			case "number": {
				// Carry optional hints only when present (exactOptionalPropertyTypes).
				const view: NumberFieldView = {
					kind: "number",
					label: field.label,
					value: field.value,
					action: field.action,
					...(field.min !== undefined ? { min: field.min } : {}),
					...(field.max !== undefined ? { max: field.max } : {}),
					...(field.step !== undefined ? { step: field.step } : {}),
					...(field.unit !== undefined ? { unit: field.unit } : {}),
				};
				fields.push(view);
				break;
			}
			case "button":
				fields.push({
					kind: "button",
					label: field.label,
					action: field.action,
				});
				break;
			case "custom":
				fields.push({
					kind: "custom",
					rendererId: field.rendererId,
					payload: field.payload,
				});
				break;
		}
	}
	return { fields };
}

/**
 * Coalesce a field list into render groups: maximal runs of consecutive `stat`
 * fields become one `stats` group (rendered as a single aligned table), every
 * other field stays a standalone `field` group. Order is preserved. Pure.
 */
export function groupRenderFields(fields: readonly FieldView[]): RenderGroup[] {
	const groups: RenderGroup[] = [];
	let run: StatFieldView[] = [];
	const flush = (): void => {
		if (run.length > 0) {
			groups.push({ type: "stats", stats: run });
			run = [];
		}
	};
	for (const field of fields) {
		if (field.kind === "stat") {
			run.push(field);
		} else {
			flush();
			groups.push({ type: "field", field });
		}
	}
	flush();
	return groups;
}

/**
 * Construct a typed `invoke` client message for an actionable field.
 * For toggle the payload is the new boolean; for selector the chosen value;
 * for button the payload is omitted.
 */
export function buildInvoke(
	surfaceId: string,
	field: Extract<FieldView, { action: unknown }>,
	value?: unknown,
): InvokeMessage {
	const base = { type: "invoke" as const, surfaceId, actionId: field.action.actionId };
	if (value !== undefined) {
		return { ...base, payload: value };
	}
	return base;
}
