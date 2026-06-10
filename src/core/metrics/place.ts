import type { Usage } from "@dispatch/wire";
import type { RenderGroup } from "../chunks";
import type { MetricsRow, TurnMetricsEntry } from "./types";

function groupStepId(g: RenderGroup): string | undefined {
	if (g.kind === "tool-batch") return g.stepId;
	const c = g.chunk.chunk;
	return c.type === "tool-call" || c.type === "tool-result" ? c.stepId : undefined;
}

/** Element-wise sum of two token usages (cache fields included only when nonzero). */
function addUsage(a: Usage, b: Usage): Usage {
	const out: Usage = {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
	};
	const read = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0);
	const write = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
	if (read > 0) (out as { cacheReadTokens?: number }).cacheReadTokens = read;
	if (write > 0) (out as { cacheWriteTokens?: number }).cacheWriteTokens = write;
	return out;
}

/**
 * Interleave turn metrics into the rendered transcript.
 *
 * Splits groups into per-turn segments: a new segment begins at each `single`
 * group with `group.chunk.role === "user"`. Head-aligns: segment `i` receives
 * `entries[i]` (the first `min(K, T)` segments get the first `min(K, T)` entries).
 *
 * Within a segment that has an aligned turn entry, each completed step's metrics
 * are placed INLINE right after the last group bearing that step's `stepId` (tool-call/
 * tool-result chunks and tool-batch groups carry `stepId`). Steps whose `stepId` does
 * not appear in any group ("unanchored") fall back to the segment tail, before the
 * turn-metrics row (if present).
 *
 * A `turn-metrics` row is emitted ONLY when `entry.total !== null` (i.e. the turn
 * is finalized via `done` or durable data). A still-generating turn emits its
 * completed step rows but NO turn-total row.
 *
 * Head-alignment is stable: the durable `/metrics` endpoint returns every
 * SEALED turn in turn order (a contiguous prefix from turn 0), and we append
 * only the just-finished live turn — so `entries[i]` is turn `i`, and existing
 * turns never move when a new turn is appended.
 */
export function interleaveTurnMetrics(
	groups: readonly RenderGroup[],
	entries: readonly TurnMetricsEntry[],
): readonly MetricsRow[] {
	if (entries.length === 0) {
		return groups.map((g) => ({ kind: "group" as const, group: g }));
	}

	const segmentStarts: number[] = [];
	for (let i = 0; i < groups.length; i++) {
		const g = groups[i];
		if (g !== undefined && g.kind === "single" && g.chunk.role === "user") {
			segmentStarts.push(i);
		}
	}

	const T = segmentStarts.length;

	if (T === 0) {
		return groups.map((g) => ({ kind: "group" as const, group: g }));
	}

	const K = entries.length;
	const matched = Math.min(K, T);

	// Head-alignment: segment i ↔ entries[i] for i in [0, matched).
	// A trailing segment with no corresponding entry renders no metrics.
	const segmentEntries = new Map<number, TurnMetricsEntry>();
	for (let i = 0; i < matched; i++) {
		const entry = entries[i];
		if (entry !== undefined) {
			segmentEntries.set(i, entry);
		}
	}

	// Running cumulative usage across finalized turns (conversation total at each
	// entry index), for the per-turn "chat total" cache rate.
	const cumulativeByEntry: Usage[] = [];
	let runningUsage: Usage = { inputTokens: 0, outputTokens: 0 };
	for (const e of entries) {
		if (e.total !== null) runningUsage = addUsage(runningUsage, e.total.usage);
		cumulativeByEntry.push(runningUsage);
	}

	const rows: MetricsRow[] = [];

	const firstUserIdx = segmentStarts[0] ?? 0;
	for (let i = 0; i < firstUserIdx; i++) {
		const g = groups[i];
		if (g !== undefined) {
			rows.push({ kind: "group", group: g });
		}
	}

	for (let seg = 0; seg < T; seg++) {
		const start = segmentStarts[seg] ?? 0;
		const end = seg + 1 < T ? (segmentStarts[seg + 1] ?? groups.length) : groups.length;

		const entry = segmentEntries.get(seg);

		if (entry === undefined) {
			for (let i = start; i < end; i++) {
				const g = groups[i];
				if (g !== undefined) {
					rows.push({ kind: "group", group: g });
				}
			}
			continue;
		}

		// Build anchor map: for each stepId, the LAST group index in this segment.
		const anchorByStepId = new Map<string, number>();
		for (let i = start; i < end; i++) {
			const g = groups[i];
			if (g === undefined) continue;
			const sid = groupStepId(g);
			if (sid !== undefined) {
				anchorByStepId.set(sid, i);
			}
		}

		// Classify each step as anchored (at a group index) or unanchored.
		const anchored: Map<number, { stepIndex: number; step: (typeof entry.steps)[number] }[]> =
			new Map();
		const unanchored: { stepIndex: number; step: (typeof entry.steps)[number] }[] = [];

		for (let i = 0; i < entry.steps.length; i++) {
			const step = entry.steps[i];
			if (step === undefined) continue;
			const anchorGroupIdx = anchorByStepId.get(step.stepId);
			if (anchorGroupIdx !== undefined) {
				let arr = anchored.get(anchorGroupIdx);
				if (arr === undefined) {
					arr = [];
					anchored.set(anchorGroupIdx, arr);
				}
				arr.push({ stepIndex: i, step });
			} else {
				unanchored.push({ stepIndex: i, step });
			}
		}

		// Emit groups; after each anchored group, emit its step-metrics rows.
		for (let i = start; i < end; i++) {
			const g = groups[i];
			if (g !== undefined) {
				rows.push({ kind: "group", group: g });
			}
			const stepsHere = anchored.get(i);
			if (stepsHere !== undefined) {
				stepsHere.sort((a, b) => a.stepIndex - b.stepIndex);
				for (const { step, stepIndex } of stepsHere) {
					rows.push({ kind: "step-metrics", step, index: stepIndex });
				}
			}
		}

		// Segment tail: unanchored steps, then turn-metrics (only when total is present).
		unanchored.sort((a, b) => a.stepIndex - b.stepIndex);
		for (const { step, stepIndex } of unanchored) {
			rows.push({ kind: "step-metrics", step, index: stepIndex });
		}
		if (entry.total !== null) {
			rows.push({
				kind: "turn-metrics",
				turn: entry.total,
				cumulativeUsage: cumulativeByEntry[seg] ?? entry.total.usage,
			});
		}
	}

	return rows;
}
