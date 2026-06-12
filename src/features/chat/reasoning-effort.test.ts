import { describe, expect, it } from "vitest";
import {
	DEFAULT_REASONING_EFFORT,
	effectiveEffort,
	effortOptions,
	isReasoningEffort,
	REASONING_EFFORT_LEVELS,
} from "./reasoning-effort";

describe("reasoning-effort helpers", () => {
	it("ladder matches the wire contract, in ascending depth order", () => {
		expect(REASONING_EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
	});

	it("the server default is high", () => {
		expect(DEFAULT_REASONING_EFFORT).toBe("high");
	});

	it("isReasoningEffort narrows ladder strings and rejects everything else", () => {
		for (const level of REASONING_EFFORT_LEVELS) {
			expect(isReasoningEffort(level)).toBe(true);
		}
		expect(isReasoningEffort("banana")).toBe(false);
		expect(isReasoningEffort("")).toBe(false);
		expect(isReasoningEffort("HIGH")).toBe(false);
	});

	it("effectiveEffort maps null (never set) to the default, not 'off'", () => {
		expect(effectiveEffort(null)).toBe("high");
	});

	it("effectiveEffort passes a persisted value through", () => {
		expect(effectiveEffort("xhigh")).toBe("xhigh");
		expect(effectiveEffort("low")).toBe("low");
	});

	it("effortOptions lists every level once and marks only the default", () => {
		const options = effortOptions();
		expect(options.map((o) => o.value)).toEqual([...REASONING_EFFORT_LEVELS]);
		expect(options.find((o) => o.value === "high")?.label).toBe("high (default)");
		for (const option of options) {
			if (option.value !== "high") expect(option.label).toBe(option.value);
		}
	});
});
