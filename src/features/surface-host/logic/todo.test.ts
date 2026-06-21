import { describe, expect, it } from "vitest";
import { parseTodoPayload, type TodoItem } from "./todo";

const item = (
	content: string,
	status: TodoItem["status"] = "pending",
	priority: TodoItem["priority"] = "medium",
): TodoItem => ({ content, status, priority });

describe("parseTodoPayload", () => {
	it("parses a well-formed payload with items", () => {
		const data = parseTodoPayload({
			todos: [
				item("Write tests", "in_progress", "high"),
				item("Ship it", "pending", "medium"),
				item("Read docs", "completed", "low"),
			],
		});
		expect(data).toEqual({
			todos: [
				item("Write tests", "in_progress", "high"),
				item("Ship it", "pending", "medium"),
				item("Read docs", "completed", "low"),
			],
		});
	});

	it("parses an empty-todos payload", () => {
		expect(parseTodoPayload({ todos: [] })).toEqual({ todos: [] });
	});

	it("preserves item order", () => {
		const data = parseTodoPayload({
			todos: [item("a"), item("b"), item("c")],
		});
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

	it("accepts all three priority values", () => {
		const data = parseTodoPayload({
			todos: [
				item("h", "pending", "high"),
				item("m", "pending", "medium"),
				item("l", "pending", "low"),
			],
		});
		expect(data?.todos.map((t) => t.priority)).toEqual(["high", "medium", "low"]);
	});

	it.each([
		["null", null],
		["a number", 7],
		["a string", "nope"],
		["missing todos key", { foo: [] }],
		["todos not an array", { todos: "x" }],
		["entry not an object", { todos: ["x"] }],
		["entry missing content", { todos: [{ status: "pending", priority: "low" }] }],
		[
			"entry with non-string content",
			{ todos: [{ content: 1, status: "pending", priority: "low" }] },
		],
		["entry missing status", { todos: [{ content: "x", priority: "low" }] }],
		["entry with invalid status", { todos: [item("x", "done" as never)] }],
		["entry missing priority", { todos: [{ content: "x", status: "pending" }] }],
		["entry with invalid priority", { todos: [item("x", "pending", "urgent" as never)] }],
	])("returns null for invalid payload: %s", (_label, payload) => {
		expect(parseTodoPayload(payload)).toBeNull();
	});
});
