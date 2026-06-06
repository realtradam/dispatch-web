import type { InvokeMessage, SurfaceSpec } from "@dispatch/ui-contract";
import type { FieldView, SurfaceRenderPlan } from "./types";

const KNOWN_KINDS = new Set(["toggle", "progress", "selector", "stat", "button"]);

/**
 * Validate and normalise a SurfaceSpec into a renderable plan.
 * Keeps known field kinds in order; drops unknown kinds and `custom` fields
 * (no renderer registry yet — graceful skip, never throw).
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
			case "button":
				fields.push({
					kind: "button",
					label: field.label,
					action: field.action,
				});
				break;
		}
	}
	return { fields };
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
