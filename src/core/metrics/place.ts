import type { Usage } from "@dispatch/wire";
import type { RenderGroup } from "../chunks";
import type { MetricsRow, StepMetrics, TurnMetricsEntry } from "./types";

function groupStepId(g: RenderGroup): string | undefined {
  if (g.kind === "tool-batch") return g.stepId;
  const c = g.chunk.chunk;
  return c.type === "tool-call" || c.type === "tool-result" ? c.stepId : undefined;
}

function groupTurnId(g: RenderGroup): string | undefined {
  return g.kind === "tool-batch" ? g.turnId : g.chunk.turnId;
}

function isUser(g: RenderGroup): boolean {
  return g.kind === "single" && g.chunk.role === "user";
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

/** A run of consecutive groups that belong to one (possibly unknown) turn. */
interface Segment {
  readonly start: number;
  readonly end: number; // exclusive
  /** Turn resolved from the segment's own groups (turnId / stepId), if any. */
  readonly known: string | undefined;
  /** Whether the segment holds model output (anything but user / error chunks). */
  readonly hasResponse: boolean;
}

/**
 * Assign every group to the turn that produced it. EXACT whenever the data
 * carries provenance — which is always for anything produced since the backend
 * began stamping `StoredChunk.turnId` (and always for live chunks, which carry
 * the live event's `turnId`):
 *
 * 1. A group's own `turnId` (committed `StoredChunk.turnId` / live event).
 * 2. Else the turn whose metrics contain the group's `stepId`.
 *
 * Only LEGACY groups (persisted before turn provenance existed, with no
 * stepId) are left; they are resolved per segment. A segment boundary is a
 * user message start (a user chunk after a non-user one, or any user TEXT
 * chunk — a message carries at most one, first; image chunks continue it) or a
 * change of known turn. A segment with a known turn assigns it to its legacy
 * groups. Runs of still-unknown (text-only legacy) segments are matched to the
 * UNCLAIMED metrics entries that lie strictly between their resolved
 * neighbours' entries — order-preserving, and only when the count is
 * unambiguous (leading runs tail-align, since chat-limit trimming removes the
 * oldest turns). An ambiguous run gets NO metrics rather than wrong ones.
 */
function assignTurns(
  groups: readonly RenderGroup[],
  entries: readonly TurnMetricsEntry[],
): (string | undefined)[] {
  const turnOfStep = new Map<string, string>();
  const entryIndex = new Map<string, number>();
  entries.forEach((e, i) => {
    entryIndex.set(e.turnId, i);
    for (const s of e.steps) turnOfStep.set(s.stepId, e.turnId);
  });

  const direct: (string | undefined)[] = groups.map((g) => {
    const t = groupTurnId(g);
    if (t !== undefined) return t;
    const sid = groupStepId(g);
    return sid !== undefined ? turnOfStep.get(sid) : undefined;
  });

  // Fast path: everything resolved directly (the normal case).
  if (direct.every((t) => t !== undefined)) return direct;

  // Segment the transcript (legacy resolution).
  const segments: Segment[] = [];
  let segStart = 0;
  let segKnown: string | undefined;
  let segHasResponse = false;
  const close = (end: number) => {
    if (end > segStart) {
      segments.push({ start: segStart, end, known: segKnown, hasResponse: segHasResponse });
    }
  };
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g === undefined) continue;
    const prev = i > 0 ? groups[i - 1] : undefined;
    const t = direct[i];
    const userStart =
      isUser(g) &&
      (prev === undefined ||
        !isUser(prev) ||
        (g.kind === "single" && g.chunk.chunk.type === "text"));
    const turnChange = t !== undefined && segKnown !== undefined && t !== segKnown;
    if (i > segStart && (userStart || turnChange)) {
      close(i);
      segStart = i;
      segKnown = undefined;
      segHasResponse = false;
    }
    if (t !== undefined && segKnown === undefined) segKnown = t;
    if (!isUser(g) && !(g.kind === "single" && g.chunk.chunk.type === "error")) {
      segHasResponse = true;
    }
  }
  close(groups.length);

  const segTurn: (string | undefined)[] = segments.map((s) => s.known);
  const claimed = new Set<number>();
  for (const t of segTurn) {
    const idx = t !== undefined ? entryIndex.get(t) : undefined;
    if (idx !== undefined) claimed.add(idx);
  }
  // Entry index of a resolved segment; a known turn with no entry yet (an
  // in-flight turn whose first step hasn't completed) sits after every entry.
  const segEntryIdx = (k: number): number => {
    const t = segTurn[k];
    if (t === undefined) return -1;
    return entryIndex.get(t) ?? entries.length;
  };

  let k = 0;
  while (k < segments.length) {
    if (segTurn[k] !== undefined) {
      k++;
      continue;
    }
    let runEnd = k;
    while (runEnd < segments.length && segTurn[runEnd] === undefined) runEnd++;
    const leading = k === 0;
    const lower = leading ? -1 : segEntryIdx(k - 1);
    const upper = runEnd < segments.length ? segEntryIdx(runEnd) : entries.length;
    const candidates: number[] = [];
    for (let e = lower + 1; e < upper; e++) if (!claimed.has(e)) candidates.push(e);

    let run: number[] = [];
    for (let s = k; s < runEnd; s++) run.push(s);
    if (run.length !== candidates.length) {
      // A segment with no model output (only the user message, or an error) is
      // a turn that failed before producing anything — or one just sent, whose
      // turn hasn't started yet — and legitimately has no metrics.
      const responsive = run.filter((s) => segments[s]?.hasResponse === true);
      if (responsive.length <= candidates.length) run = responsive;
    }
    let pick: number[] | null = null;
    if (run.length === candidates.length) pick = candidates;
    else if (leading && run.length < candidates.length) pick = candidates.slice(-run.length);
    if (pick !== null) {
      run.forEach((s, i) => {
        const e = pick?.[i];
        const entry = e !== undefined ? entries[e] : undefined;
        if (entry !== undefined && e !== undefined) {
          segTurn[s] = entry.turnId;
          claimed.add(e);
        }
      });
    }
    k = runEnd;
  }

  const out = [...direct];
  segments.forEach((s, si) => {
    const t = segTurn[si];
    if (t === undefined) return;
    for (let i = s.start; i < s.end; i++) if (out[i] === undefined) out[i] = t;
  });
  return out;
}

/**
 * Interleave per-turn / per-step metrics into the rendered transcript.
 *
 * Every group is attributed to the turn that produced it (see `assignTurns` —
 * exact via `turnId` provenance; a guarded order-preserving fallback only for
 * legacy rows). Then:
 * - each completed step's metrics row goes right after the LAST group bearing
 *   that step's `stepId` (steps with no visible content — text-only steps, or
 *   content unloaded by the chat limit — get no row);
 * - a finalized turn's (`entry.total !== null`) metrics row goes right after
 *   the LAST group of that turn — so a turn whose user message was unloaded
 *   still shows its total under its visible tail, and a mid-turn steering
 *   message never pulls the total up.
 *
 * Because attribution never depends on counting user messages, sending a new
 * message, a new turn streaming, steering, image attachments, errored turns, or
 * chat-limit unloading can never shift one turn's metrics onto another.
 *
 * Turns whose content is fully unloaded are not rendered (no wall of stale
 * rows at the top) but still count toward the running "chat total".
 */
export function interleaveTurnMetrics(
  groups: readonly RenderGroup[],
  entries: readonly TurnMetricsEntry[],
): readonly MetricsRow[] {
  if (entries.length === 0) {
    return groups.map((g) => ({ kind: "group" as const, group: g }));
  }

  const turnOf = assignTurns(groups, entries);

  const entryByTurn = new Map<string, { entry: TurnMetricsEntry; index: number }>();
  entries.forEach((entry, index) => {
    entryByTurn.set(entry.turnId, { entry, index });
  });

  // Running cumulative usage across ALL finalized turns (entry order), and the
  // previous finalized turn's LAST step usage (the retention baseline: the
  // prompt that turn last sent, which the next turn's first step should hit in
  // cache).
  const cumulativeByEntry: Usage[] = [];
  const prevLastStepByEntry: (Usage | null)[] = [];
  let runningUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let lastFinalizedStep: Usage | null = null;
  for (const e of entries) {
    prevLastStepByEntry.push(lastFinalizedStep);
    if (e.total !== null) {
      runningUsage = addUsage(runningUsage, e.total.usage);
      const last = e.total.steps[e.total.steps.length - 1];
      if (last !== undefined) lastFinalizedStep = last.usage;
    }
    cumulativeByEntry.push(runningUsage);
  }

  // Anchor positions: last group of each step (within its turn) / each turn.
  const lastGroupOfStep = new Map<string, number>();
  const lastGroupOfTurn = new Map<string, number>();
  groups.forEach((g, i) => {
    const t = turnOf[i];
    if (t === undefined) return;
    lastGroupOfTurn.set(t, i);
    const sid = groupStepId(g);
    if (sid !== undefined) lastGroupOfStep.set(sid, i);
  });

  const stepsAt = new Map<number, { step: StepMetrics; index: number }[]>();
  for (const entry of entries) {
    entry.steps.forEach((step, index) => {
      const at = lastGroupOfStep.get(step.stepId);
      if (at === undefined || turnOf[at] !== entry.turnId) return;
      let arr = stepsAt.get(at);
      if (arr === undefined) {
        arr = [];
        stepsAt.set(at, arr);
      }
      arr.push({ step, index });
    });
  }

  const rows: MetricsRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g === undefined) continue;
    rows.push({ kind: "group", group: g });

    const steps = stepsAt.get(i);
    if (steps !== undefined) {
      steps.sort((a, b) => a.index - b.index);
      for (const { step, index } of steps) rows.push({ kind: "step-metrics", step, index });
    }

    const t = turnOf[i];
    if (t === undefined || lastGroupOfTurn.get(t) !== i) continue;
    const found = entryByTurn.get(t);
    if (found === undefined || found.entry.total === null) continue;
    rows.push({
      kind: "turn-metrics",
      turn: found.entry.total,
      turnNumber: found.index + 1,
      cumulativeUsage: cumulativeByEntry[found.index] ?? found.entry.total.usage,
      prevLastStepUsage: prevLastStepByEntry[found.index] ?? null,
    });
  }

  return rows;
}
