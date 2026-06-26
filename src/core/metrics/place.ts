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
 * group with `group.chunk.role === "user"`. Segments are matched to entries
 * by `stepId` presence when possible (robust against chat-limit trimming: when
 * a turn's user message is trimmed, head-alignment would be off by one, but
 * stepId matching still finds the right entry). Segments with no stepId-bearing
 * groups (text-only turns) fall back to sequential matching against unused
 * entries.
 *
 * Within a segment that has a matched entry, each completed step's metrics
 * are placed INLINE right after the last group bearing that step's `stepId`.
 * Steps whose `stepId` does not appear in any group ("unanchored"):
 * - If the segment HAS stepId-bearing groups (tool chunks exist but this step's
 *   were trimmed): SKIPPED (no blank "step N · 0 tok" bubbles).
 * - If the segment has NO stepId-bearing groups (text-only turn): placed at the
 *   segment tail before the turn-metrics row (the original behavior).
 *
 * A `turn-metrics` row is emitted ONLY when `entry.total !== null` (i.e. the turn
 * is finalized via `done` or durable data). A still-generating turn emits no
 * turn-total row.
 *
 * Cumulative usage is computed across finalized turns in entry-array order
 * (turn order), so the per-turn "chat total" cache rate is correct regardless
 * of which turns were trimmed.
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

  let T = segmentStarts.length;

  // No user messages — e.g. a compacted conversation whose history starts
  // with a system summary. Treat the entire transcript as one segment so
  // turn/step metrics can still be placed.
  if (T === 0 && entries.length > 0) {
    segmentStarts.push(0);
    T = 1;
  }

  if (T === 0) {
    return groups.map((g) => ({ kind: "group" as const, group: g }));
  }

  const K = entries.length;

  // Build stepId → entry-index lookup for matching.
  const entryStepIds: Set<string>[] = entries.map((e) => new Set(e.steps.map((s) => s.stepId)));

  // Match segments to entries. Pass 1: match by stepId overlap (handles
  // trimming where head-alignment would be wrong). Pass 2: sequential fallback
  // for unmatched segments (text-only turns with no stepId-bearing groups).
  const usedEntries = new Set<number>();
  const segmentEntry = new Map<number, TurnMetricsEntry>();
  const segmentEntryIndex = new Map<number, number>();

  // Pass 1: stepId matching.
  for (let seg = 0; seg < T; seg++) {
    const start = segmentStarts[seg] ?? 0;
    const end = seg + 1 < T ? (segmentStarts[seg + 1] ?? groups.length) : groups.length;

    const segStepIds = new Set<string>();
    for (let i = start; i < end; i++) {
      const g = groups[i];
      if (g === undefined) continue;
      const sid = groupStepId(g);
      if (sid !== undefined) segStepIds.add(sid);
    }
    if (segStepIds.size === 0) continue; // text-only — defer to pass 2

    let bestEntry = -1;
    let bestMatch = 0;
    for (let i = 0; i < K; i++) {
      if (usedEntries.has(i)) continue;
      let match = 0;
      for (const sid of segStepIds) {
        if (entryStepIds[i]?.has(sid)) match++;
      }
      if (match > bestMatch) {
        bestMatch = match;
        bestEntry = i;
      }
    }
    if (bestEntry >= 0) {
      usedEntries.add(bestEntry);
      const e = entries[bestEntry];
      if (e !== undefined) {
        segmentEntry.set(seg, e);
        segmentEntryIndex.set(seg, bestEntry);
      }
    }
  }

  // Pass 2: sequential fallback for unmatched segments.
  // If NO segments were matched by stepId (pass 1), use TAIL-ALIGNMENT:
  // the loaded chunks are always the NEWEST (chat-limit/windowing keeps the
  // newest and trims the oldest), so match the LAST T entries to the T
  // segments. This prevents misaligning oldest (trimmed) entries to newest
  // segments — which would show "turn 1" on turn 20's content.
  const pass1Matches = segmentEntry.size;
  if (pass1Matches === 0 && K >= T) {
    // Tail-align: skip the first K-T entries (trimmed turns).
    for (let seg = 0; seg < T; seg++) {
      if (segmentEntry.has(seg)) continue;
      const entryIdx = K - T + seg;
      if (entryIdx < K && !usedEntries.has(entryIdx)) {
        usedEntries.add(entryIdx);
        const e = entries[entryIdx];
        if (e !== undefined) {
          segmentEntry.set(seg, e);
          segmentEntryIndex.set(seg, entryIdx);
        }
      }
    }
  } else {
    // Head-align fallback for remaining unmatched segments.
    let nextUnused = 0;
    for (let seg = 0; seg < T; seg++) {
      if (segmentEntry.has(seg)) continue;
      while (nextUnused < K && usedEntries.has(nextUnused)) nextUnused++;
      if (nextUnused < K) {
        usedEntries.add(nextUnused);
        const e = entries[nextUnused];
        if (e !== undefined) {
          segmentEntry.set(seg, e);
          segmentEntryIndex.set(seg, nextUnused);
        }
        nextUnused++;
      }
    }
  }

  // Running cumulative usage across ALL finalized turns (in entry order), for
  // the per-turn "chat total" cache rate. Alongside it, the previous finalized
  // turn's usage at each index — the baseline for cross-turn retention.
  const cumulativeByEntry: Usage[] = [];
  const prevUsageByEntry: (Usage | null)[] = [];
  let runningUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let lastFinalizedUsage: Usage | null = null;
  for (const e of entries) {
    prevUsageByEntry.push(lastFinalizedUsage);
    if (e.total !== null) {
      runningUsage = addUsage(runningUsage, e.total.usage);
      lastFinalizedUsage = e.total.usage;
    }
    cumulativeByEntry.push(runningUsage);
  }

  const rows: MetricsRow[] = [];

  const firstUserIdx = segmentStarts[0] ?? 0;

  // Emit turn-metrics rows for entries that weren't matched to any segment
  // (fully trimmed turns — their content was unloaded by the chat limit, but
  // their aggregate metrics still show so the user knows what was trimmed).
  for (let i = 0; i < entries.length; i++) {
    if (usedEntries.has(i)) continue;
    const e = entries[i];
    if (e === undefined || e.total === null) continue;
    rows.push({
      kind: "turn-metrics",
      turn: e.total,
      turnNumber: i + 1,
      cumulativeUsage: cumulativeByEntry[i] ?? e.total.usage,
      prevTurnUsage: prevUsageByEntry[i] ?? null,
    });
  }

  for (let i = 0; i < firstUserIdx; i++) {
    const g = groups[i];
    if (g !== undefined) {
      rows.push({ kind: "group", group: g });
    }
  }

  for (let seg = 0; seg < T; seg++) {
    const start = segmentStarts[seg] ?? 0;
    const end = seg + 1 < T ? (segmentStarts[seg + 1] ?? groups.length) : groups.length;

    const entry = segmentEntry.get(seg);

    if (entry === undefined) {
      for (let i = start; i < end; i++) {
        const g = groups[i];
        if (g !== undefined) {
          rows.push({ kind: "group", group: g });
        }
      }
      continue;
    }

    const entryIdx = segmentEntryIndex.get(seg) ?? 0;

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

    // Classify each step as anchored or unanchored. Unanchored steps
    // (content trimmed, or text-only steps with no tool chunks) are SKIPPED —
    // step-metrics are only shown inline next to the content they describe.
    const anchored: Map<number, { stepIndex: number; step: (typeof entry.steps)[number] }[]> =
      new Map();

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
      }
      // Unanchored steps (no matching group) are skipped — no tail bubbles.
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

    // Turn-metrics row (only when the turn is finalized). Unanchored steps
    // are skipped — no tail bubbles.
    if (entry.total !== null) {
      rows.push({
        kind: "turn-metrics",
        turn: entry.total,
        turnNumber: entryIdx + 1,
        cumulativeUsage: cumulativeByEntry[entryIdx] ?? entry.total.usage,
        prevTurnUsage: prevUsageByEntry[entryIdx] ?? null,
      });
    }
  }

  return rows;
}
