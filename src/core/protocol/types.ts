import type {
	SurfaceCatalog,
	SurfaceClientMessage,
	SurfaceErrorMessage,
	SurfaceSpec,
} from "@dispatch/ui-contract";

/**
 * One surface subscription's local state.
 *
 * `conversationId` is the conversation we last subscribed this surface WITH
 * (`undefined` = subscribed globally, no conversation in focus). It is the
 * "desired" scope: an inbound `surface`/`update` that echoes a DIFFERENT
 * conversation is stale (we have since re-scoped) and is dropped. A GLOBAL
 * surface ignores the id server-side and echoes none — that (`undefined` echo)
 * is always accepted. `spec` is `null` until the first `surface` arrives.
 */
export interface Subscription {
	readonly conversationId: string | undefined;
	readonly spec: SurfaceSpec | null;
}

/** The client-side view of the surface protocol state. */
export interface ProtocolState {
	/** The latest catalog received from the server (empty until first CatalogMessage). */
	readonly catalog: SurfaceCatalog;
	/** Surfaces the client intends to be subscribed to, keyed by surfaceId. */
	readonly subscriptions: ReadonlyMap<string, Subscription>;
	/** The last error received from the server, if any. */
	readonly lastError: SurfaceErrorMessage | null;
}

/** A state transition result: the next state plus any outgoing messages to send. */
export interface ProtocolResult {
	readonly state: ProtocolState;
	readonly outgoing: readonly SurfaceClientMessage[];
}
