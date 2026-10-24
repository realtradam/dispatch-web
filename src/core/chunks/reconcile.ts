import type { StoredChunk } from "@dispatch/wire";
import type { ProvisionalChunk, TranscriptState } from "./types";

/**
 * A persisted tool call proves its entire assistant step committed atomically.
 * Text/thinking wire chunks have no stepId: their provisional provenance is
 * learned from tool-call/step-complete, never from text equality. This also
 * handles a window starting midway through the step and an omitted prefix.
 * Also usable when HTTP finished before replay/live flush.
 */
export function historyBackedProvisional(
  state: TranscriptState,
  committed: readonly StoredChunk[] = state.committed,
): ReadonlySet<ProvisionalChunk> {
  const backed = new Set<ProvisionalChunk>();
  if (!state.historyRecoveryTurnIds?.length) return backed;
  const steps = new Set<string>();
  const steeringAnchors = new Set<string>();
  let lastResult: StoredChunk | undefined;
  const toolRows = new Map<string, Set<string | undefined>>();
  for (const row of committed) {
    const c = row.chunk;
    if (row.role === "assistant" || row.turnId !== lastResult?.turnId) lastResult = undefined;
    if (c.type === "tool-result") lastResult = row;
    if (row.role === "user" && c.type === "text" && lastResult?.chunk.type === "tool-result") {
      steeringAnchors.add(`${row.turnId}\0${lastResult.chunk.toolCallId}`);
    }
    if (c.type === "tool-call" || c.type === "tool-result") {
      const key = `${row.turnId}\0${c.type}\0${c.toolCallId}`;
      const ids = toolRows.get(key) ?? new Set<string | undefined>();
      ids.add(c.stepId);
      toolRows.set(key, ids);
      if (c.type === "tool-call" && c.stepId !== undefined) steps.add(`${row.turnId}\0${c.stepId}`);
    }
  }
  for (const p of state.provisional) {
    if (p.turnId === undefined || !state.historyRecoveryTurnIds?.includes(p.turnId)) continue;
    const c = p.chunk;
    if (c.type === "tool-call" || c.type === "tool-result") {
      const ids = toolRows.get(`${p.turnId}\0${c.type}\0${c.toolCallId}`);
      if (ids !== undefined && (c.stepId === undefined || ids.has(undefined) || ids.has(c.stepId)))
        backed.add(p);
    } else if (p.afterToolCallId !== undefined && p.role === "user") {
      if (steeringAnchors.has(`${p.turnId}\0${p.afterToolCallId}`)) backed.add(p);
    } else if (p.opening && c.type === "text") {
      // The opening is the first user row of this turn; steering is NOT opening.
      const first = committed.find((row) => row.turnId === p.turnId);
      if (first?.role === "user" && first.chunk.type === "text") backed.add(p);
    } else if (p.stepId !== undefined && p.role === "assistant") {
      if (steps.has(`${p.turnId}\0${p.stepId}`)) backed.add(p);
    }
  }
  return backed;
}
