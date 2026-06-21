/**
 * Pure parser for the `rendererId: "todo"` custom-field payload.
 *
 * The `todo` backend extension maintains a per-conversation task list (written
 * by the model via a `todo_write` tool) and exposes it as a read-only
 * conversation-scoped surface with one `custom` field
 * (`rendererId: "todo"`, `payload: TodoPayload`). This parser validates the
 * untyped `payload: unknown` at the network seam so a hostile/partial payload
 * can never crash the renderer (graceful skip → null).
 *
 * The `TodoItem` type is NOT in `@dispatch/wire` — it is defined by the `todo`
 * extension and carried in the surface payload, so we define it here (the FE's
 * rendering contract for the shape). Empty `todos` is a valid, parseable state
 * (the model hasn't created a list / cleared it); the caller hides the panel.
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
	readonly content: string;
	readonly status: TodoStatus;
}

export interface TodoData {
	readonly todos: readonly TodoItem[];
}

const STATUSES = new Set<string>(["pending", "in_progress", "completed", "cancelled"]);

function isTodoItem(v: unknown): v is TodoItem {
	if (typeof v !== "object" || v === null) return false;
	const o = v as Record<string, unknown>;
	return typeof o.content === "string" && typeof o.status === "string" && STATUSES.has(o.status);
}

export function parseTodoPayload(payload: unknown): TodoData | null {
	if (typeof payload !== "object" || payload === null) return null;
	const obj = payload as Record<string, unknown>;
	const raw = obj.todos;
	if (!Array.isArray(raw)) return null;
	const todos: TodoItem[] = [];
	for (const entry of raw) {
		if (!isTodoItem(entry)) return null;
		todos.push(entry);
	}
	return { todos };
}

/** The `rendererId` the `todo` extension's `custom` surface field uses. */
export const TODO_RENDERER_ID = "todo";
