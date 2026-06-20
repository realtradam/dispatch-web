import type { QueuedMessage } from "@dispatch/wire";

/**
 * Pure parser for the `rendererId: "message-queue"` custom-field payload.
 *
 * The message-queue extension's per-conversation surface emits ONE `custom`
 * field with `rendererId: "message-queue"` and `payload: QueuePayload`
 * (`{ messages: QueuedMessage[] }` — the current queue snapshot). This parser
 * validates the untyped `payload: unknown` at the network seam so a
 * hostile/partial payload can never crash the renderer (graceful skip → null).
 *
 * Empty `messages` is a valid, parseable state (the queue is empty — nothing to
 * render); the caller hides the panel. Null is returned only for a malformed
 * payload shape.
 */
export interface MessageQueueData {
	readonly messages: readonly QueuedMessage[];
}

function isQueuedMessage(v: unknown): v is QueuedMessage {
	if (typeof v !== "object" || v === null) return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.id === "string" &&
		typeof o.text === "string" &&
		typeof o.queuedAt === "number" &&
		Number.isFinite(o.queuedAt)
	);
}

export function parseMessageQueuePayload(payload: unknown): MessageQueueData | null {
	if (typeof payload !== "object" || payload === null) return null;
	const obj = payload as Record<string, unknown>;
	const raw = obj.messages;
	if (!Array.isArray(raw)) return null;
	const messages: QueuedMessage[] = [];
	for (const entry of raw) {
		if (!isQueuedMessage(entry)) return null;
		messages.push(entry);
	}
	return { messages };
}

/** The `rendererId` the message-queue extension's `custom` surface field uses. */
export const MESSAGE_QUEUE_RENDERER_ID = "message-queue";
