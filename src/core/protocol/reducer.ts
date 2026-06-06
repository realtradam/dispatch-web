import type {
	InvokeMessage,
	SubscribeMessage,
	SurfaceServerMessage,
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

/** Fold an inbound server message into the next protocol state. */
export function applyServerMessage(state: ProtocolState, msg: SurfaceServerMessage): ProtocolState {
	switch (msg.type) {
		case "catalog":
			return { ...state, catalog: msg.catalog };

		case "surface": {
			const surfaceId = msg.spec.id;
			if (!state.subscriptions.has(surfaceId)) return state;
			const subs = new Map(state.subscriptions);
			subs.set(surfaceId, msg.spec);
			return { ...state, subscriptions: subs };
		}

		case "update": {
			const surfaceId = msg.update.surfaceId;
			if (!state.subscriptions.has(surfaceId)) return state;
			const subs = new Map(state.subscriptions);
			subs.set(surfaceId, msg.update.spec);
			return { ...state, subscriptions: subs };
		}

		case "error":
			return { ...state, lastError: msg };
	}
}

/**
 * Subscribe to a surface. Idempotent: if already subscribed, returns the same
 * state with no outgoing message.
 */
export function subscribe(state: ProtocolState, surfaceId: string): ProtocolResult {
	if (state.subscriptions.has(surfaceId)) {
		return { state, outgoing: [] };
	}
	const subs = new Map(state.subscriptions);
	subs.set(surfaceId, null);
	const outgoing: SubscribeMessage = { type: "subscribe", surfaceId };
	return { state: { ...state, subscriptions: subs }, outgoing: [outgoing] };
}

/**
 * Unsubscribe from a surface. Drops the local spec and emits one unsubscribe.
 * If not subscribed, returns the same state with no outgoing.
 */
export function unsubscribe(state: ProtocolState, surfaceId: string): ProtocolResult {
	if (!state.subscriptions.has(surfaceId)) {
		return { state, outgoing: [] };
	}
	const subs = new Map(state.subscriptions);
	subs.delete(surfaceId);
	const outgoing: UnsubscribeMessage = { type: "unsubscribe", surfaceId };
	return { state: { ...state, subscriptions: subs }, outgoing: [outgoing] };
}

/** Invoke a field's action on a surface. Emits an InvokeMessage; no state change. */
export function invoke(
	state: ProtocolState,
	surfaceId: string,
	actionId: string,
	payload?: unknown,
): ProtocolResult {
	const outgoing: InvokeMessage = { type: "invoke", surfaceId, actionId, payload };
	return { state, outgoing: [outgoing] };
}
