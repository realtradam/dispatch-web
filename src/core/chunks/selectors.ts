import type { ChatMessage, Chunk, StoredChunk, TurnProviderRetryEvent } from "@dispatch/wire";
import type { ProvisionalChunk, RenderedChunk, TranscriptState } from "./types";

/**
 * Whether a provisional chunk is the same content as a committed chunk at the
 * same position of the same turn (identity for de-dup, not deep equality).
 * Tool chunks match by `toolCallId`; text-bearing chunks by exact text.
 */
function sameChunk(p: ProvisionalChunk, c: StoredChunk): boolean {
  if (p.role !== c.role || p.chunk.type !== c.chunk.type) return false;
  const a = p.chunk;
  const b = c.chunk;
  switch (a.type) {
    case "tool-call":
    case "tool-result":
      return a.toolCallId === (b as typeof a).toolCallId;
    case "text":
    case "thinking":
    case "system":
      return a.text === (b as typeof a).text;
    case "error":
      return a.message === (b as typeof a).message;
    case "image":
      return true;
  }
}

/**
 * How many LEADING provisional chunks are already backed by committed chunks.
 *
 * The backend persists each step of an in-flight turn as it completes (CR-6),
 * so a client that opens a conversation mid-turn gets those steps from history
 * AND again from the late-join event replay (as provisional chunks). Both
 * carry the turn's chunks in the same order, so the provisional run of turn T
 * is aligned position-by-position with the committed run of turn T. Skip the
 * aligned prefix; stop at the first mismatch (fail-safe: a misalignment shows
 * a duplicate, never hides content).
 *
 * Also reports whether the ACCUMULATING chunk is already committed (the step
 * completed + history synced, but the next live event hasn't flushed it yet).
 */
function committedOverlap(state: TranscriptState): { skip: number; hideAccumulating: boolean } {
  const first = state.provisional[0];
  const turnId = first?.turnId ?? state.accumulating?.turnId;
  if (turnId === undefined) return { skip: 0, hideAccumulating: false };
  // The committed run for this turn (contiguous at the tail of `committed`).
  let start = state.committed.length;
  while (start > 0 && state.committed[start - 1]?.turnId === turnId) start--;
  const run = state.committed.length - start;
  if (run === 0) return { skip: 0, hideAccumulating: false };

  let skip = 0;
  while (skip < state.provisional.length && skip < run) {
    const p = state.provisional[skip];
    const c = state.committed[start + skip];
    if (p === undefined || c === undefined || p.turnId !== turnId || !sameChunk(p, c)) break;
    skip++;
  }

  let hideAccumulating = false;
  const acc = state.accumulating;
  if (acc !== null && skip === state.provisional.length && skip < run) {
    const c = state.committed[start + skip];
    hideAccumulating =
      c !== undefined &&
      c.role === "assistant" &&
      c.chunk.type === acc.kind &&
      c.chunk.text === acc.text;
  }
  return { skip, hideAccumulating };
}

/**
 * Select all chunks for rendering: committed first (seq order),
 * then provisional (seq: null) — minus provisional chunks already backed by
 * committed history (see `committedOverlap`).
 */
export function selectChunks(state: TranscriptState): readonly RenderedChunk[] {
  const result: RenderedChunk[] = [];
  const { skip, hideAccumulating } = committedOverlap(state);
  for (const c of state.committed) {
    result.push(
      c.turnId !== undefined
        ? { seq: c.seq, role: c.role, chunk: c.chunk, provisional: false, turnId: c.turnId }
        : { seq: c.seq, role: c.role, chunk: c.chunk, provisional: false },
    );
  }
  for (let i = skip; i < state.provisional.length; i++) {
    const p = state.provisional[i];
    if (p === undefined) continue;
    result.push(
      p.turnId !== undefined
        ? { seq: null, role: p.role, chunk: p.chunk, provisional: true, turnId: p.turnId }
        : { seq: null, role: p.role, chunk: p.chunk, provisional: true },
    );
  }
  const acc = state.accumulating;
  if (acc !== null && !hideAccumulating) {
    const chunk: Chunk =
      acc.kind === "text" ? { type: "text", text: acc.text } : { type: "thinking", text: acc.text };
    result.push({
      seq: null,
      role: "assistant",
      chunk,
      provisional: true,
      streaming: true,
      ...(acc.turnId !== undefined ? { turnId: acc.turnId } : {}),
    });
  }
  return result;
}

/**
 * Whether a turn is currently generating (for a "generating…" indicator). True
 * for ANY client watching the conversation — the sender, a second device, or a
 * reconnected client whose in-flight turn was replayed.
 */
export function selectGenerating(state: TranscriptState): boolean {
  return state.generating;
}

/**
 * The latest `provider-retry` event for the current turn, or `null` when no retry
 * is pending. Drives the transient yellow "retrying…" warning banner (rendered
 * by ChatView). Never persisted — see `TranscriptState.providerRetry`.
 */
export function selectProviderRetry(state: TranscriptState): TurnProviderRetryEvent | null {
  return state.providerRetry;
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
