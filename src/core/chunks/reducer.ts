import type { AgentEvent, Chunk, StoredChunk } from "@dispatch/wire";
import type { AccumulatingChunk, ProvisionalChunk, TranscriptState } from "./types";

/** The initial empty transcript state. */
export function initialState(): TranscriptState {
	return {
		committed: [],
		provisional: [],
		accumulating: null,
		currentTurnId: null,
		latestUsage: null,
		sealedTurnId: null,
		hiddenBeforeSeq: 0,
		hiddenThinkingCount: 0,
		generating: false,
	};
}

/**
 * Clear the `generating` flag without touching anything else. Used on a WS
 * (re)connect: a turn may have sealed while we were disconnected, so the live
 * `turn-sealed`/`done` that would have cleared `generating` was missed. The
 * caller resets here, then re-subscribes — if the turn is still running the
 * server's replay re-asserts `generating` via the replayed `turn-start`.
 */
export function clearGenerating(state: TranscriptState): TranscriptState {
	if (!state.generating) return state;
	return { ...state, generating: false };
}

function flushAccumulating(
	provisional: readonly ProvisionalChunk[],
	acc: AccumulatingChunk | null,
): readonly ProvisionalChunk[] {
	if (acc === null) return provisional;
	const chunk: Chunk =
		acc.kind === "text" ? { type: "text", text: acc.text } : { type: "thinking", text: acc.text };
	return [...provisional, { role: "assistant", chunk }];
}

/**
 * Merge authoritative seq-keyed chunks into the committed history.
 * Dedupes by seq (new wins), keeps seq-monotonic order, idempotent.
 * When sealedTurnId is set, drops all provisional chunks (now superseded)
 * and clears sealedTurnId.
 *
 * Chunks below the chat-limit unload watermark (`hiddenBeforeSeq`) are
 * REJECTED: a full-cache or tail merge must not resurrect what the trim
 * unloaded. Restoring earlier history goes through `restoreEarlier` instead.
 */
export function applyHistory(
	state: TranscriptState,
	chunks: readonly StoredChunk[],
): TranscriptState {
	const seqMap = new Map<number, StoredChunk>();
	for (const c of state.committed) seqMap.set(c.seq, c);
	let addedNew = false;
	for (const c of chunks) {
		if (c.seq < state.hiddenBeforeSeq) continue;
		if (!seqMap.has(c.seq)) addedNew = true;
		seqMap.set(c.seq, c);
	}
	const committed = Array.from(seqMap.values()).sort((a, b) => a.seq - b.seq);

	if (state.sealedTurnId !== null) {
		return {
			...state,
			committed,
			provisional: [],
			accumulating: null,
			sealedTurnId: null,
		};
	}

	// During generation: if new committed chunks arrived, the provisional
	// array may contain duplicates — the optimistic echo from `appendUserMessage`
	// is now backed by a committed chunk (CR-6: user message persisted at turn
	// start). Remove provisional chunks that match the last committed chunk
	// (role + chunk content), keeping only the accumulating (streaming) chunk.
	if (addedNew && state.generating && state.provisional.length > 0) {
		const lastCommitted = committed[committed.length - 1];
		if (lastCommitted !== undefined) {
			const provisional = state.provisional.filter((p) => {
				if (p.role !== lastCommitted.role) return true;
				if (p.chunk.type !== lastCommitted.chunk.type) return true;
				if (p.chunk.type === "text" && lastCommitted.chunk.type === "text") {
					return p.chunk.text !== lastCommitted.chunk.text;
				}
				return true;
			});
			return { ...state, committed, provisional, accumulating: state.accumulating };
		}
	}

	return { ...state, committed };
}

/**
 * Fold one live AgentEvent into the provisional state.
 *
 * - `turn-start` records the turnId.
 * - `user-message` appends the turn's user prompt (de-duped vs the sender's
 *   optimistic echo) so a watcher renders it mid-turn.
 * - `text-delta` extends the current accumulating TextChunk (or starts one).
 * - `reasoning-delta` extends the current accumulating ThinkingChunk (or starts one).
 * - `tool-call` / `tool-result` / `error` finalize any accumulating chunk and
 *   add a new provisional chunk.
 * - `steering` appends a user bubble mid-turn (drained from the message queue
 *   at a tool-result boundary; the queue surface separately clears on drain).
 * - `usage` stores the latest Usage.
 * - `done` finalizes any accumulating chunk (turn still provisional).
 * - `turn-sealed` finalizes any accumulating chunk and sets sealedTurnId.
 * - `status` and `tool-output` are ignored (best-effort no-ops).
 *
 * `generating` is folded structurally: a `turn-start` or any content delta sets
 * it true; `done` / `turn-sealed` / `error` clear it. This is what a watching
 * (or reconnected) client renders as "generating…", with no dependence on the
 * free-form `status` event string.
 */
export function foldEvent(state: TranscriptState, event: AgentEvent): TranscriptState {
	switch (event.type) {
		case "status":
		case "tool-output":
			return state;

		case "turn-start":
			return { ...state, currentTurnId: event.turnId, generating: true };

		case "user-message": {
			// The turn's USER prompt, surfaced on the event stream (backend CR-3) so a
			// WATCHER/late-joiner renders it mid-turn instead of waiting for seal. The
			// SENDER already echoed its own prompt optimistically (`appendUserMessage`),
			// so DE-DUP: skip if the trailing provisional chunk is already an identical
			// user text chunk. A pure watcher has no such echo → it appends and renders.
			if (event.text.length === 0) return state;
			const last = state.provisional[state.provisional.length - 1];
			if (
				last !== undefined &&
				last.role === "user" &&
				last.chunk.type === "text" &&
				last.chunk.text === event.text
			) {
				return { ...state, generating: true };
			}
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			return {
				...state,
				provisional: [...provisional, { role: "user", chunk: { type: "text", text: event.text } }],
				accumulating: null,
				generating: true,
			};
		}

		case "text-delta": {
			const acc = state.accumulating;
			if (acc !== null && acc.kind === "text") {
				return {
					...state,
					accumulating: { kind: "text", text: acc.text + event.delta },
					generating: true,
				};
			}
			const provisional = flushAccumulating(state.provisional, acc);
			return {
				...state,
				provisional,
				accumulating: { kind: "text", text: event.delta },
				generating: true,
			};
		}

		case "reasoning-delta": {
			const acc = state.accumulating;
			if (acc !== null && acc.kind === "thinking") {
				return {
					...state,
					accumulating: { kind: "thinking", text: acc.text + event.delta },
					generating: true,
				};
			}
			const provisional = flushAccumulating(state.provisional, acc);
			return {
				...state,
				provisional,
				accumulating: { kind: "thinking", text: event.delta },
				generating: true,
			};
		}

		case "tool-call": {
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			const chunk: Chunk = {
				type: "tool-call",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
				stepId: event.stepId,
			};
			return {
				...state,
				provisional: [...provisional, { role: "assistant", chunk }],
				accumulating: null,
				generating: true,
			};
		}

		case "tool-result": {
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			const chunk: Chunk = {
				type: "tool-result",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				content: event.content,
				isError: event.isError,
				stepId: event.stepId,
			};
			return {
				...state,
				provisional: [...provisional, { role: "tool", chunk }],
				accumulating: null,
				generating: true,
			};
		}

		case "error": {
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			const chunk: Chunk =
				event.code !== undefined
					? { type: "error", message: event.message, code: event.code }
					: { type: "error", message: event.message };
			return {
				...state,
				provisional: [...provisional, { role: "assistant", chunk }],
				accumulating: null,
				generating: false,
			};
		}

		case "usage":
			return { ...state, latestUsage: event.usage };

		case "step-complete":
			// Timing metadata — no content chunk; handled by the telemetry reducer.
			return state;

		case "done": {
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			return {
				...state,
				provisional,
				accumulating: null,
				generating: false,
			};
		}

		case "turn-sealed": {
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			return {
				...state,
				provisional,
				accumulating: null,
				sealedTurnId: event.turnId,
				generating: false,
			};
		}

		case "steering": {
			// A steering message drained from the queue at a tool-result boundary
			// (the model sees it alongside the tool results). Append a user bubble
			// to the provisional transcript; the turn is still in flight. The queue
			// surface clears separately on drain (a different channel) — no de-dup
			// here (unlike `user-message`, steering is never optimistically echoed
			// into the transcript by the sender).
			if (event.text.length === 0) return state;
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			return {
				...state,
				provisional: [...provisional, { role: "user", chunk: { type: "text", text: event.text } }],
				accumulating: null,
				generating: true,
			};
		}
	}
}

/**
 * Optimistically append a user message to the provisional list.
 * Flushes any in-progress accumulating chunk first (defensively).
 * The provisional user chunk is superseded when applyHistory receives
 * the authoritative committed chunks after a turn seals.
 */
export function appendUserMessage(state: TranscriptState, text: string): TranscriptState {
	const provisional = flushAccumulating(state.provisional, state.accumulating);
	const userChunk: Chunk = { type: "text", text };
	return {
		...state,
		provisional: [...provisional, { role: "user", chunk: userChunk }],
		accumulating: null,
	};
}
