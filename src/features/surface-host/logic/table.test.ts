import { describe, expect, it } from "vitest";
import { parseTablePayload } from "./table";

describe("parseTablePayload", () => {
	it("parses a well-formed table payload", () => {
		const data = parseTablePayload({
			columns: ["Name", "Version"],
			rows: [
				["alpha", "1.0"],
				["beta", "2.3"],
			],
		});
		expect(data).toEqual({
			columns: ["Name", "Version"],
			rows: [
				["alpha", "1.0"],
				["beta", "2.3"],
			],
		});
	});

	it("coerces numeric and boolean cells to strings", () => {
		const data = parseTablePayload({
			columns: ["k", "n", "b"],
			rows: [["x", 42, true]],
		});
		expect(data?.rows[0]).toEqual(["x", "42", "true"]);
	});

	it("accepts an empty rows array", () => {
		expect(parseTablePayload({ columns: ["A"], rows: [] })).toEqual({ columns: ["A"], rows: [] });
	});

	it.each([
		["null", null],
		["a number", 7],
		["a string", "nope"],
		["missing columns", { rows: [] }],
		["missing rows", { columns: ["A"] }],
		["non-string column", { columns: [1], rows: [] }],
		["row that is not an array", { columns: ["A"], rows: ["x"] }],
		["cell of unsupported type", { columns: ["A"], rows: [[{ nested: true }]] }],
		["non-finite numeric cell", { columns: ["A"], rows: [[Number.NaN]] }],
	])("returns null for invalid payload: %s", (_label, payload) => {
		expect(parseTablePayload(payload)).toBeNull();
	});
});
