import type { Chunk, Role, StoredChunk, Usage } from "@dispatch/wire";

/** A chunk being accumulated from streaming deltas (text or thinking). */
export interface AccumulatingChunk {
	readonly kind: "text" | "thinking";
	readonly text: string;
}

/** A provisional chunk that has no authoritative seq yet. */
export interface ProvisionalChunk {
	readonly role: Role;
	readonly chunk: Chunk;
}

/** The transcript reducer state. Holds committed history + live in-flight turn. */
export interface TranscriptState {
	readonly committed: readonly StoredChunk[];
	readonly provisional: readonly ProvisionalChunk[];
	readonly accumulating: AccumulatingChunk | null;
	readonly currentTurnId: string | null;
	readonly latestUsage: Usage | null;
	readonly sealedTurnId: string | null;
}

/** A chunk ready for rendering: either committed (with seq) or provisional. */
export interface RenderedChunk {
	readonly seq: number | null;
	readonly role: Role;
	readonly chunk: Chunk;
	readonly provisional: boolean;
}
