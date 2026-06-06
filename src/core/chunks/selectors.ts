import type { ChatMessage, Chunk } from "@dispatch/wire";
import type { RenderedChunk, TranscriptState } from "./types";

/**
 * Select all chunks for rendering: committed first (seq order),
 * then provisional (seq: null).
 */
export function selectChunks(state: TranscriptState): readonly RenderedChunk[] {
	const result: RenderedChunk[] = [];
	for (const c of state.committed) {
		result.push({ seq: c.seq, role: c.role, chunk: c.chunk, provisional: false });
	}
	for (const p of state.provisional) {
		result.push({ seq: null, role: p.role, chunk: p.chunk, provisional: true });
	}
	if (state.accumulating !== null) {
		const chunk: Chunk =
			state.accumulating.kind === "text"
				? { type: "text", text: state.accumulating.text }
				: { type: "thinking", text: state.accumulating.text };
		result.push({ seq: null, role: "assistant", chunk, provisional: true });
	}
	return result;
}

/**
 * Group consecutive same-role rendered chunks into ChatMessages.
 */
export function selectMessages(state: TranscriptState): readonly ChatMessage[] {
	const rendered = selectChunks(state);
	const first = rendered[0];
	if (first === undefined) return [];

	const messages: ChatMessage[] = [];
	let role = first.role;
	let chunks: Chunk[] = [first.chunk];

	for (let i = 1; i < rendered.length; i++) {
		const rc = rendered[i];
		if (rc === undefined) continue;
		if (rc.role === role) {
			chunks.push(rc.chunk);
		} else {
			messages.push({ role, chunks });
			role = rc.role;
			chunks = [rc.chunk];
		}
	}
	messages.push({ role, chunks });
	return messages;
}
