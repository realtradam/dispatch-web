import type {
	ChatDeltaMessage,
	ChatErrorMessage,
	WsClientMessage,
	WsServerMessage,
} from "@dispatch/transport-contract";
import type {
	CatalogMessage,
	SurfaceErrorMessage,
	SurfaceMessage,
	SurfaceUpdateMessage,
} from "@dispatch/ui-contract";

const VALID_SERVER_TYPES = new Set([
	"catalog",
	"surface",
	"update",
	"error",
	"chat.delta",
	"chat.error",
]);

/** Serialize a client message to a JSON string for the wire. */
export function serialize(msg: WsClientMessage): string {
	return JSON.stringify(msg);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Parse a raw server message string into a typed WsServerMessage.
 * Returns null for malformed JSON or shapes that don't match the protocol.
 */
export function parseServerMessage(data: string): WsServerMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) {
		return null;
	}
	const t = parsed.type;
	if (typeof t !== "string" || !VALID_SERVER_TYPES.has(t)) {
		return null;
	}
	switch (t) {
		case "catalog": {
			if (!Array.isArray(parsed.catalog)) return null;
			return { type: "catalog", catalog: parsed.catalog as CatalogMessage["catalog"] };
		}
		case "surface": {
			const spec = parsed.spec;
			if (!isRecord(spec)) return null;
			if (typeof spec.id !== "string") return null;
			if (typeof spec.region !== "string") return null;
			if (typeof spec.title !== "string") return null;
			if (!Array.isArray(spec.fields)) return null;
			// Preserve the conversationId echo (a conversation-scoped surface's initial
			// reply carries it) — dropping it would defeat the protocol reducer's
			// stale-scope filtering on a fast conversation switch.
			const conversationId = parsed.conversationId;
			if (conversationId !== undefined && typeof conversationId !== "string") return null;
			const surfaceSpec = spec as unknown as SurfaceMessage["spec"];
			return conversationId !== undefined
				? { type: "surface", spec: surfaceSpec, conversationId }
				: { type: "surface", spec: surfaceSpec };
		}
		case "update": {
			const update = parsed.update;
			if (!isRecord(update)) return null;
			if (typeof update.surfaceId !== "string") return null;
			const spec = update.spec;
			if (!isRecord(spec)) return null;
			if (typeof spec.id !== "string") return null;
			if (typeof spec.region !== "string") return null;
			if (typeof spec.title !== "string") return null;
			if (!Array.isArray(spec.fields)) return null;
			return { type: "update", update: update as unknown as SurfaceUpdateMessage["update"] };
		}
		case "error": {
			if (typeof parsed.message !== "string") return null;
			const surfaceId = parsed.surfaceId;
			if (surfaceId !== undefined && typeof surfaceId !== "string") return null;
			const msg: SurfaceErrorMessage =
				surfaceId !== undefined
					? { type: "error", surfaceId, message: parsed.message }
					: { type: "error", message: parsed.message };
			return msg;
		}
		case "chat.delta": {
			const event = parsed.event;
			if (!isRecord(event)) return null;
			if (typeof event.type !== "string") return null;
			return { type: "chat.delta", event: event as unknown as ChatDeltaMessage["event"] };
		}
		case "chat.error": {
			if (typeof parsed.message !== "string") return null;
			const conversationId = parsed.conversationId;
			if (conversationId !== undefined && typeof conversationId !== "string") return null;
			const msg: ChatErrorMessage =
				conversationId !== undefined
					? { type: "chat.error", conversationId, message: parsed.message }
					: { type: "chat.error", message: parsed.message };
			return msg;
		}
		default:
			return null;
	}
}

/**
 * Bounded exponential backoff with jitter.
 * Base: 500ms, doubles each attempt, caps at 30s, adds ±20% jitter.
 */
export function nextBackoffMs(attempt: number): number {
	const base = 500;
	const max = 30_000;
	const exponential = base * 2 ** Math.max(0, attempt);
	const capped = Math.min(exponential, max);
	const jitter = 0.8 + Math.random() * 0.4;
	return Math.round(capped * jitter);
}
