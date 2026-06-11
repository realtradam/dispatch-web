import type {
	InvokeMessage,
	SubscribeMessage,
	SurfaceServerMessage,
	SurfaceSpec,
	UnsubscribeMessage,
} from "@dispatch/ui-contract";
import type { ProtocolResult, ProtocolState } from "./types";

/** The initial protocol state: empty catalog, no subscriptions, no error. */
export function initialState(): ProtocolState {
	return {
		catalog: [],
		subscriptions: new Map(),
		lastError: null,
	};
}

// ── Message builders (respect exactOptionalPropertyTypes: omit `conversationId`
//    entirely for a global subscription rather than setting it to `undefined`). ──

function subMsg(surfaceId: string, conversationId: string | undefined): SubscribeMessage {
	return conversationId === undefined
		? { type: "subscribe", surfaceId }
		: { type: "subscribe", surfaceId, conversationId };
}

function unsubMsg(surfaceId: string, conversationId: string | undefined): UnsubscribeMessage {
	return conversationId === undefined
		? { type: "unsubscribe", surfaceId }
		: { type: "unsubscribe", surfaceId, conversationId };
}

/**
 * Is an inbound spec/update (which echoes `echoedId`) current for the
 * subscription whose desired scope is `desiredId`? A scoped surface echoes its
 * conversationId, so it must match the one we last subscribed with; a GLOBAL
 * surface echoes nothing (`undefined`) and is always current.
 */
function isCurrent(desiredId: string | undefined, echoedId: string | undefined): boolean {
	return echoedId === undefined || echoedId === desiredId;
}

/** Fold an inbound server message into the next protocol state. */
export function applyServerMessage(state: ProtocolState, msg: SurfaceServerMessage): ProtocolState {
	switch (msg.type) {
		case "catalog":
			return { ...state, catalog: msg.catalog };

		case "surface": {
			const sub = state.subscriptions.get(msg.spec.id);
			if (sub === undefined) return state;
			if (!isCurrent(sub.conversationId, msg.conversationId)) return state;
			const subs = new Map(state.subscriptions);
			subs.set(msg.spec.id, { conversationId: sub.conversationId, spec: msg.spec });
			return { ...state, subscriptions: subs };
		}

		case "update": {
			const { surfaceId, spec, conversationId } = msg.update;
			const sub = state.subscriptions.get(surfaceId);
			if (sub === undefined) return state;
			if (!isCurrent(sub.conversationId, conversationId)) return state;
			const subs = new Map(state.subscriptions);
			subs.set(surfaceId, { conversationId: sub.conversationId, spec });
			return { ...state, subscriptions: subs };
		}

		case "error":
			return { ...state, lastError: msg };
	}
}

/**
 * Subscribe to a surface for a given conversation (omit `conversationId` for a
 * GLOBAL surface / when no conversation is focused).
 *
 * - Not yet subscribed → emits one `subscribe`.
 * - Already subscribed with the SAME scope → idempotent no-op.
 * - Already subscribed with a DIFFERENT conversation (a re-scope on conversation
 *   switch) → emits `unsubscribe` for the old pair then `subscribe` for the new
 *   one, retaining the previous spec until the new one arrives (no flicker).
 */
export function subscribe(
	state: ProtocolState,
	surfaceId: string,
	conversationId?: string,
): ProtocolResult {
	const existing = state.subscriptions.get(surfaceId);
	if (existing !== undefined && existing.conversationId === conversationId) {
		return { state, outgoing: [] };
	}
	const subs = new Map(state.subscriptions);
	const outgoing: (SubscribeMessage | UnsubscribeMessage)[] = [];
	const priorSpec: SurfaceSpec | null = existing?.spec ?? null;
	if (existing !== undefined) {
		outgoing.push(unsubMsg(surfaceId, existing.conversationId));
	}
	subs.set(surfaceId, { conversationId, spec: priorSpec });
	outgoing.push(subMsg(surfaceId, conversationId));
	return { state: { ...state, subscriptions: subs }, outgoing };
}

/**
 * Unsubscribe from a surface. Drops the local subscription and emits one
 * `unsubscribe` (for the conversation pair it was subscribed under). No-op if
 * not subscribed.
 */
export function unsubscribe(state: ProtocolState, surfaceId: string): ProtocolResult {
	const existing = state.subscriptions.get(surfaceId);
	if (existing === undefined) {
		return { state, outgoing: [] };
	}
	const subs = new Map(state.subscriptions);
	subs.delete(surfaceId);
	return {
		state: { ...state, subscriptions: subs },
		outgoing: [unsubMsg(surfaceId, existing.conversationId)],
	};
}

/**
 * Invoke a field's action on a surface. Emits an InvokeMessage (carrying
 * `conversationId` for a scoped surface); no state change.
 */
export function invoke(
	state: ProtocolState,
	surfaceId: string,
	actionId: string,
	payload?: unknown,
	conversationId?: string,
): ProtocolResult {
	const outgoing: InvokeMessage =
		conversationId === undefined
			? { type: "invoke", surfaceId, actionId, payload }
			: { type: "invoke", surfaceId, actionId, payload, conversationId };
	return { state, outgoing: [outgoing] };
}

/** The current spec for a subscribed surface, or `null` if absent/unsubscribed. */
export function getSurfaceSpec(state: ProtocolState, surfaceId: string): SurfaceSpec | null {
	return state.subscriptions.get(surfaceId)?.spec ?? null;
}
