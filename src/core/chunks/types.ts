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
	/**
	 * The chat-limit UNLOAD watermark: committed chunks with `seq <` this are
	 * unloaded (not in `committed`, not rendered) to keep long transcripts cheap.
	 * `0` = nothing unloaded. `applyHistory` refuses chunks below it (a cache/tail
	 * merge must not resurrect what the trim dropped); "Show earlier messages"
	 * lowers it via `restoreEarlier`. See `trim.ts`.
	 */
	readonly hiddenBeforeSeq: number;
	/**
	 * How many thinking-type chunks are currently unloaded below the watermark.
	 * Pure render-key bookkeeping: the UI keys thinking collapses by ORDINAL (so
	 * the key survives the provisional→committed seal transition), and this base
	 * keeps those ordinals stable when a trim removes older thinking chunks —
	 * otherwise every remaining collapse would shift keys and swap/lose its
	 * open state mid-stream.
	 */
	readonly hiddenThinkingCount: number;
	/**
	 * True while a turn is generating on the server — derived STRUCTURALLY from the
	 * event stream: a `turn-start` (or any turn delta) with no matching `done` /
	 * `turn-sealed` / `error` yet. A late-joiner that subscribes mid-turn gets the
	 * in-flight turn replayed from its `turn-start`, so this lights up for any
	 * watching client. NOT inferred from the free-form `status` event string.
	 */
	readonly generating: boolean;
}

/** A chunk ready for rendering: either committed (with seq) or provisional. */
export interface RenderedChunk {
	readonly seq: number | null;
	readonly role: Role;
	readonly chunk: Chunk;
	readonly provisional: boolean;
	/**
	 * True only for the single chunk currently being accumulated from live deltas
	 * (the in-flight text/thinking the model is actively generating). Absent/false
	 * once flushed or committed. Lets the UI show a live indicator (e.g. loading
	 * dots on streaming thinking) and drop it the moment generation moves on.
	 */
	readonly streaming?: boolean;
}
