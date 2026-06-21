import { describe, expect, it } from "vitest";
import { parseTodoPayload, type TodoItem } from "./todo";

const item = (content: string, status: TodoItem["status"] = "pending"): TodoItem => ({
	content,
	status,
});

describe("parseTodoPayload", () => {
	it("parses a well-formed payload with items", () => {
		const data = parseTodoPayload({
			todos: [
				item("Write tests", "in_progress"),
				item("Ship it", "pending"),
				item("Read docs", "completed"),
			],
		});
		expect(data).toEqual({
			todos: [
				item("Write tests", "in_progress"),
				item("Ship it", "pending"),
				item("Read docs", "completed"),
			],
		});
	});

	it("parses an empty-todos payload", () => {
		expect(parseTodoPayload({ todos: [] })).toEqual({ todos: [] });
	});

	it("preserves item order", () => {
		const data = parseTodoPayload({ todos: [item("a"), item("b"), item("c")] });
		expect(data?.todos.map((t) => t.content)).toEqual(["a", "b", "c"]);
	});

	it("accepts all four status values", () => {
		const data = parseTodoPayload({
			todos: [
				item("p", "pending"),
				item("i", "in_progress"),
				item("c", "completed"),
				item("x", "cancelled"),
			],
		});
		expect(data?.todos.map((t) => t.status)).toEqual([
			"pending",
			"in_progress",
			"completed",
			"cancelled",
		]);
	});

	it.each([
		["null", null],
		["a number", 7],
		["a string", "nope"],
		["missing todos key", { foo: [] }],
		["todos not an array", { todos: "x" }],
		["entry not an object", { todos: ["x"] }],
		["entry missing content", { todos: [{ status: "pending" }] }],
		["entry with non-string content", { todos: [{ content: 1, status: "pending" }] }],
		["entry missing status", { todos: [{ content: "x" }] }],
		["entry with invalid status", { todos: [item("x", "done" as never)] }],
	])("returns null for invalid payload: %s", (_label, payload) => {
		expect(parseTodoPayload(payload)).toBeNull();
	});
});
