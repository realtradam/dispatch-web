import type {
	CatalogMessage,
	SurfaceClientMessage,
	SurfaceErrorMessage,
	SurfaceMessage,
	SurfaceServerMessage,
	SurfaceUpdateMessage,
} from "@dispatch/ui-contract";

const VALID_SERVER_TYPES = new Set(["catalog", "surface", "update", "error"]);

/** Serialize a client message to a JSON string for the wire. */
export function serialize(msg: SurfaceClientMessage): string {
	return JSON.stringify(msg);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Parse a raw server message string into a typed SurfaceServerMessage.
 * Returns null for malformed JSON or shapes that don't match the protocol.
 */
export function parseServerMessage(data: string): SurfaceServerMessage | null {
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
			return { type: "surface", spec: spec as unknown as SurfaceMessage["spec"] };
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
