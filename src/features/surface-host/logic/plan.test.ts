import type { SurfaceField, SurfaceSpec } from "@dispatch/ui-contract";
import { describe, expect, it } from "vitest";
import { buildInvoke, planSurface } from "./plan";

const makeSpec = (...fields: SurfaceField[]): SurfaceSpec => ({
	id: "test-surface",
	region: "test",
	title: "Test Surface",
	fields,
});

describe("planSurface", () => {
	it("maps a toggle field to a ToggleFieldView", () => {
		const plan = planSurface(
			makeSpec({ kind: "toggle", label: "Dark mode", value: true, action: { actionId: "dm" } }),
		);
		expect(plan.fields).toEqual([
			{ kind: "toggle", label: "Dark mode", value: true, action: { actionId: "dm" } },
		]);
	});

	it("maps a progress field to a ProgressFieldView", () => {
		const plan = planSurface(makeSpec({ kind: "progress", label: "Loading", value: 0.42 }));
		expect(plan.fields).toEqual([{ kind: "progress", label: "Loading", value: 0.42 }]);
	});

	it("maps a selector field to a SelectorFieldView", () => {
		const plan = planSurface(
			makeSpec({
				kind: "selector",
				label: "Model",
				value: "gpt-4",
				options: [
					{ value: "gpt-4", label: "GPT-4" },
					{ value: "gpt-3.5", label: "GPT-3.5" },
				],
				action: { actionId: "set-model" },
			}),
		);
		expect(plan.fields).toEqual([
			{
				kind: "selector",
				label: "Model",
				value: "gpt-4",
				options: [
					{ value: "gpt-4", label: "GPT-4" },
					{ value: "gpt-3.5", label: "GPT-3.5" },
				],
				action: { actionId: "set-model" },
			},
		]);
	});

	it("maps a stat field to a StatFieldView", () => {
		const plan = planSurface(makeSpec({ kind: "stat", label: "Tokens", value: "1,234" }));
		expect(plan.fields).toEqual([{ kind: "stat", label: "Tokens", value: "1,234" }]);
	});

	it("maps a button field to a ButtonFieldView", () => {
		const plan = planSurface(
			makeSpec({ kind: "button", label: "Retry", action: { actionId: "retry" } }),
		);
		expect(plan.fields).toEqual([
			{ kind: "button", label: "Retry", action: { actionId: "retry" } },
		]);
	});

	it("preserves field order", () => {
		const plan = planSurface(
			makeSpec(
				{ kind: "stat", label: "A", value: "1" },
				{ kind: "toggle", label: "B", value: false, action: { actionId: "b" } },
				{ kind: "progress", label: "C", value: 0.5 },
				{ kind: "button", label: "D", action: { actionId: "d" } },
			),
		);
		expect(plan.fields.map((f) => f.label)).toEqual(["A", "B", "C", "D"]);
	});

	it("drops unknown field kinds gracefully", () => {
		const plan = planSurface(
			makeSpec({ kind: "stat", label: "Known", value: "ok" }, {
				kind: "future-kind" as "stat",
				label: "Unknown",
				value: "?",
			} as SurfaceField),
		);
		expect(plan.fields).toHaveLength(1);
		expect(plan.fields[0]?.label).toBe("Known");
	});

	it("drops custom fields (no renderer registered)", () => {
		const plan = planSurface(
			makeSpec(
				{ kind: "stat", label: "Before", value: "1" },
				{ kind: "custom", rendererId: "chart", payload: { data: [1, 2, 3] } },
				{ kind: "stat", label: "After", value: "2" },
			),
		);
		expect(plan.fields).toHaveLength(2);
		expect(plan.fields.map((f) => f.label)).toEqual(["Before", "After"]);
	});

	it("returns empty fields for an empty spec", () => {
		const plan = planSurface(makeSpec());
		expect(plan.fields).toEqual([]);
	});

	it("drops all fields when all are custom", () => {
		const plan = planSurface(
			makeSpec(
				{ kind: "custom", rendererId: "x", payload: null },
				{ kind: "custom", rendererId: "y", payload: 42 },
			),
		);
		expect(plan.fields).toEqual([]);
	});
});

describe("buildInvoke", () => {
	it("builds an invoke message for a toggle field", () => {
		const field = { kind: "toggle" as const, label: "T", value: false, action: { actionId: "t" } };
		const msg = buildInvoke("s1", field, true);
		expect(msg).toEqual({ type: "invoke", surfaceId: "s1", actionId: "t", payload: true });
	});

	it("builds an invoke message for a selector field", () => {
		const field = {
			kind: "selector" as const,
			label: "S",
			value: "a",
			options: [],
			action: { actionId: "sel" },
		};
		const msg = buildInvoke("s1", field, "b");
		expect(msg).toEqual({ type: "invoke", surfaceId: "s1", actionId: "sel", payload: "b" });
	});

	it("builds an invoke message without payload for a button field", () => {
		const field = { kind: "button" as const, label: "B", action: { actionId: "btn" } };
		const msg = buildInvoke("s1", field);
		expect(msg).toEqual({ type: "invoke", surfaceId: "s1", actionId: "btn" });
	});

	it("omits payload key when value is undefined", () => {
		const field = { kind: "button" as const, label: "B", action: { actionId: "btn" } };
		const msg = buildInvoke("s1", field, undefined);
		expect(msg).not.toHaveProperty("payload");
	});

	it("uses the field's actionId, not a surface-level id", () => {
		const field = {
			kind: "toggle" as const,
			label: "X",
			value: true,
			action: { actionId: "custom-action-123" },
		};
		const msg = buildInvoke("surf", field, false);
		expect(msg.actionId).toBe("custom-action-123");
	});
});
