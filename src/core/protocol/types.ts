import type {
	SurfaceCatalog,
	SurfaceClientMessage,
	SurfaceErrorMessage,
	SurfaceSpec,
} from "@dispatch/ui-contract";

/** The client-side view of the surface protocol state. */
export interface ProtocolState {
	/** The latest catalog received from the server (empty until first CatalogMessage). */
	readonly catalog: SurfaceCatalog;
	/** Surfaces the client intends to be subscribed to; null = subscribed but no spec yet. */
	readonly subscriptions: ReadonlyMap<string, SurfaceSpec | null>;
	/** The last error received from the server, if any. */
	readonly lastError: SurfaceErrorMessage | null;
}

/** A state transition result: the next state plus any outgoing messages to send. */
export interface ProtocolResult {
	readonly state: ProtocolState;
	readonly outgoing: readonly SurfaceClientMessage[];
}
