import type { ToolCallChunk, ToolResultChunk } from "@dispatch/wire";
import type { RenderedChunk } from "./types";

/**
 * One tool call within a batch, paired with its result (matched by `toolCallId`).
 * `result` is null while the call is still pending (no result chunk yet).
 */
export interface ToolBatchEntry {
	readonly call: ToolCallChunk;
	readonly result: ToolResultChunk | null;
}

/**
 * A render group: either a single rendered chunk (rendered as today) or a batch
 * of tool calls the model emitted together in one step (shared `stepId`), to be
 * rendered as one grouped unit.
 */
export type RenderGroup =
	| { readonly kind: "single"; readonly chunk: RenderedChunk }
	| {
			readonly kind: "tool-batch";
			readonly stepId: string;
			readonly entries: readonly ToolBatchEntry[];
			readonly provisional: boolean;
	  };

/**
 * Group a flat rendered-chunk stream for display. Tool calls sharing a `stepId`
 * (the backend's authoritative batch key) where the step has 2+ calls become one
 * `tool-batch` group, positioned at the first call and pairing each call with its
 * `tool-result` (by `toolCallId`); the absorbed result chunks are not emitted on
 * their own. Single tool calls (one per step, or no `stepId` — e.g. pre-0.2.0
 * replay rows) and every non-tool chunk render as `single` groups, in order.
 *
 * Pure: input → output, no DOM, no Svelte.
 */
export function groupRenderedChunks(rendered: readonly RenderedChunk[]): readonly RenderGroup[] {
	// 1. Steps that batched 2+ tool calls.
	const callsPerStep = new Map<string, number>();
	for (const rc of rendered) {
		if (rc.chunk.type === "tool-call" && rc.chunk.stepId !== undefined) {
			callsPerStep.set(rc.chunk.stepId, (callsPerStep.get(rc.chunk.stepId) ?? 0) + 1);
		}
	}
	const batchSteps = new Set<string>();
	for (const [stepId, count] of callsPerStep) {
		if (count >= 2) batchSteps.add(stepId);
	}

	// 2. toolCallIds belonging to a batch (so their results are absorbed), and a
	//    lookup of result chunks by toolCallId for pairing.
	const batchCallIds = new Set<string>();
	const resultByCallId = new Map<string, ToolResultChunk>();
	for (const rc of rendered) {
		const chunk = rc.chunk;
		if (chunk.type === "tool-call" && chunk.stepId !== undefined && batchSteps.has(chunk.stepId)) {
			batchCallIds.add(chunk.toolCallId);
		} else if (chunk.type === "tool-result" && !resultByCallId.has(chunk.toolCallId)) {
			resultByCallId.set(chunk.toolCallId, chunk);
		}
	}

	// 3. Emit groups in stream order; each batch lands at its first call.
	const groups: RenderGroup[] = [];
	const emittedSteps = new Set<string>();
	for (const rc of rendered) {
		const chunk = rc.chunk;

		if (chunk.type === "tool-call" && chunk.stepId !== undefined && batchSteps.has(chunk.stepId)) {
			const stepId = chunk.stepId;
			if (emittedSteps.has(stepId)) continue;
			emittedSteps.add(stepId);

			const entries: ToolBatchEntry[] = [];
			let provisional = false;
			for (const inner of rendered) {
				if (inner.chunk.type === "tool-call" && inner.chunk.stepId === stepId) {
					const result = resultByCallId.get(inner.chunk.toolCallId) ?? null;
					entries.push({ call: inner.chunk, result });
					if (inner.provisional) provisional = true;
				}
			}
			groups.push({ kind: "tool-batch", stepId, entries, provisional });
			continue;
		}

		if (chunk.type === "tool-result" && batchCallIds.has(chunk.toolCallId)) {
			continue; // absorbed into its batch
		}

		groups.push({ kind: "single", chunk: rc });
	}

	return groups;
}
