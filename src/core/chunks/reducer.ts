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
	};
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
 */
export function applyHistory(
	state: TranscriptState,
	chunks: readonly StoredChunk[],
): TranscriptState {
	const seqMap = new Map<number, StoredChunk>();
	for (const c of state.committed) seqMap.set(c.seq, c);
	for (const c of chunks) seqMap.set(c.seq, c);
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

	return { ...state, committed };
}

/**
 * Fold one live AgentEvent into the provisional state.
 *
 * - `turn-start` records the turnId.
 * - `text-delta` extends the current accumulating TextChunk (or starts one).
 * - `reasoning-delta` extends the current accumulating ThinkingChunk (or starts one).
 * - `tool-call` / `tool-result` / `error` finalize any accumulating chunk and
 *   add a new provisional chunk.
 * - `usage` stores the latest Usage.
 * - `done` finalizes any accumulating chunk (turn still provisional).
 * - `turn-sealed` finalizes any accumulating chunk and sets sealedTurnId.
 * - `status` and `tool-output` are ignored (best-effort no-ops).
 */
export function foldEvent(state: TranscriptState, event: AgentEvent): TranscriptState {
	switch (event.type) {
		case "status":
		case "tool-output":
			return state;

		case "turn-start":
			return { ...state, currentTurnId: event.turnId };

		case "text-delta": {
			const acc = state.accumulating;
			if (acc !== null && acc.kind === "text") {
				return { ...state, accumulating: { kind: "text", text: acc.text + event.delta } };
			}
			const provisional = flushAccumulating(state.provisional, acc);
			return {
				...state,
				provisional,
				accumulating: { kind: "text", text: event.delta },
			};
		}

		case "reasoning-delta": {
			const acc = state.accumulating;
			if (acc !== null && acc.kind === "thinking") {
				return { ...state, accumulating: { kind: "thinking", text: acc.text + event.delta } };
			}
			const provisional = flushAccumulating(state.provisional, acc);
			return {
				...state,
				provisional,
				accumulating: { kind: "thinking", text: event.delta },
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
			};
		}

		case "turn-sealed": {
			const provisional = flushAccumulating(state.provisional, state.accumulating);
			return {
				...state,
				provisional,
				accumulating: null,
				sealedTurnId: event.turnId,
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
