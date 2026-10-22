import type { ChatMessage, Chunk, StoredChunk, TurnProviderRetryEvent } from "@dispatch/wire";
import { historyBackedProvisional } from "./reconcile";
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
 * A committed chunk with no live-event counterpart, so a late-join replay can
 * never contain it: an image persisted into the turn's history (pasted-image
 * openings, images a tool attaches mid-turn). Alignment steps over it.
 */
function replayless(c: StoredChunk): boolean {
  return c.chunk.type === "image";
}

/** Where an alignment walk stopped, and whether it stopped on a mismatch. */
interface Walk {
  /** First provisional index NOT matched. */
  readonly p: number;
  /** First committed index NOT matched (replayless chunks stepped over). */
  readonly c: number;
  readonly matched: number;
  /** Ended because a side ran out — no mismatch. */
  readonly complete: boolean;
}

/**
 * How many consecutive committed chunks starting at `c` one provisional text /
 * thinking chunk stands for: their texts must concatenate EXACTLY to its text
 * (≥ 2 chunks; 0 = no such run). A provider may return several blocks in one
 * step (Claude emits multiple thinking blocks, each with its own signature)
 * which history persists as separate chunks, while the delta stream carries
 * no block boundary — so live (and in the replay) they arrive merged.
 */
function mergedRun(
  state: TranscriptState,
  text: string,
  kind: string,
  role: string,
  c: number,
): number {
  let joined = "";
  for (let k = c; k < state.committed.length; k++) {
    const row = state.committed[k];
    if (row === undefined || row.role !== role || row.chunk.type !== kind) return 0;
    if (row.chunk.type !== "text" && row.chunk.type !== "thinking") return 0;
    joined += row.chunk.text;
    if (joined === text) return k - c + 1 >= 2 ? k - c + 1 : 0;
    if (!text.startsWith(joined)) return 0;
  }
  return 0;
}

/**
 * Walk provisional (from `p`) and committed (from `c`) of turn `turnId` in
 * lockstep, stepping over committed chunks the replay cannot carry and
 * matching one merged provisional block against its split committed run.
 * Stops at the first mismatch or when either side runs out.
 */
function walk(state: TranscriptState, turnId: string, p: number, c: number): Walk {
  let matched = 0;
  for (;;) {
    const prov = state.provisional[p];
    let row = state.committed[c];
    while (row !== undefined && replayless(row) && prov?.chunk.type !== "image") {
      row = state.committed[++c];
    }
    if (prov === undefined || row === undefined) return { p, c, matched, complete: true };
    if (prov.turnId !== turnId) return { p, c, matched, complete: false };
    let span = sameChunk(prov, row) ? 1 : 0;
    if (span === 0 && (prov.chunk.type === "text" || prov.chunk.type === "thinking")) {
      span = mergedRun(state, prov.chunk.text, prov.chunk.type, prov.role, c);
    }
    if (span === 0) return { p, c, matched, complete: false };
    p++;
    c += span;
    matched++;
  }
}

/**
 * Accept a re-anchored alignment. A tool chunk is a unique identity
 * (`toolCallId`), so a match on one is trusted outright; a text-bearing match
 * must be confirmed by the WHOLE overlap aligning (no mismatch), so a repeated
 * text can never hide divergent content.
 */
function anchored(w: Walk, anchor: StoredChunk): boolean {
  if (w.matched === 0) return false;
  return w.complete || anchor.chunk.type === "tool-call" || anchor.chunk.type === "tool-result";
}

/**
 * Align the provisional run with the committed run of turn T (which begins at
 * committed index `start`). Returns how many leading provisional chunks are
 * hidden as already committed, and the walk's end.
 *
 * Normally both start at the turn's opening. But the chat-limit window (fresh
 * load `?limit=` / `windowTranscript`) and `trimTranscript` unload the OLDEST
 * committed chunks, so in a long in-flight turn the committed run is a SUFFIX
 * of the turn while the late-join replay re-delivers the whole turn from its
 * `turn-start`: re-anchor on the committed head inside the replay, and hide
 * the replayed chunks before it too (persisted history, unloaded — pageable
 * via "Show earlier"). Conversely, provisional overflow trimming can leave the
 * replay starting after the committed head: re-anchor on the replay's head
 * inside the committed run. Unverifiable → the plain prefix walk (fail-safe:
 * a misalignment shows a duplicate, never hides content).
 */
function align(state: TranscriptState, turnId: string, start: number): Walk {
  const direct = walk(state, turnId, 0, start);
  // Aligned from the turn's head (or fully consistent): plain prefix semantics.
  if (direct.complete || direct.matched > 0) return direct;
  let headAt = start;
  while (
    state.committed[headAt] !== undefined &&
    replayless(state.committed[headAt] as StoredChunk)
  )
    headAt++;
  // Anchor on the committed head — or, when the head is unmatchable (e.g. the
  // window cut between two blocks a merged provisional chunk spans), on the
  // run's first tool chunk, a unique identity.
  const anchorsAt = [headAt];
  for (let i = headAt + 1; i < state.committed.length; i++) {
    const t = state.committed[i]?.chunk.type;
    if (t === "tool-call" || t === "tool-result") {
      anchorsAt.push(i);
      break;
    }
  }
  for (const at of anchorsAt) {
    const head = state.committed[at];
    if (head === undefined) continue;
    for (let k = 1; k < state.provisional.length; k++) {
      const p = state.provisional[k];
      if (p?.turnId !== turnId || !sameChunk(p, head)) continue;
      const w = walk(state, turnId, k, at);
      if (anchored(w, head)) return w;
    }
  }
  const p0 = state.provisional[0];
  if (p0 !== undefined) {
    for (let j = headAt + 1; j < state.committed.length; j++) {
      const row = state.committed[j];
      if (row === undefined || !sameChunk(p0, row)) continue;
      const w = walk(state, turnId, 0, j);
      if (anchored(w, row)) return w;
    }
  }
  return direct;
}

/**
 * How many LEADING provisional chunks are already backed by committed chunks.
 *
 * The backend persists each step of an in-flight turn as it completes (CR-6),
 * so a client that opens a conversation mid-turn gets those steps from history
 * AND again from the late-join event replay (as provisional chunks). Both
 * carry the turn's chunks in the same order, so the provisional run of turn T
 * is aligned chunk-by-chunk with the committed run of turn T (see `align`).
 * Skip the aligned prefix; stop at the first mismatch.
 *
 * A failed alignment renders the ENTIRE replay as a duplicate — and because
 * tool cards de-dup by `toolCallId` onto the first (committed) occurrence,
 * that duplicate tail shows only thinking/text blocks ("the tool calls
 * disappear"). Hence the re-anchoring and the replayless-image stepping.
 *
 * Also reports whether the ACCUMULATING chunk is already committed (the step
 * completed + history synced, but the next live event hasn't flushed it yet).
 */
function committedOverlap(state: TranscriptState): { skip: number; hideAccumulating: boolean } {
  const first = state.provisional[0];
  const turnId = first?.turnId ?? state.accumulating?.turnId;
  if (turnId === undefined || state.historyRecoveryTurnIds?.includes(turnId))
    return { skip: 0, hideAccumulating: false };
  // The committed run for this turn (contiguous at the tail of `committed`).
  let start = state.committed.length;
  while (start > 0 && state.committed[start - 1]?.turnId === turnId) start--;
  if (start === state.committed.length) return { skip: 0, hideAccumulating: false };

  const end = align(state, turnId, start);
  const skip = end.p;

  let hideAccumulating = false;
  const acc = state.accumulating;
  if (acc !== null && acc.turnId === turnId && skip === state.provisional.length) {
    let next = end.c;
    while (state.committed[next] !== undefined && replayless(state.committed[next] as StoredChunk))
      next++;
    const c = state.committed[next];
    hideAccumulating =
      (c !== undefined &&
        c.role === "assistant" &&
        c.chunk.type === acc.kind &&
        c.chunk.text === acc.text) ||
      mergedRun(state, acc.text, acc.kind, "assistant", next) > 0;
  }
  return { skip, hideAccumulating };
}

/**
 * How many chunks `selectChunks` would render, without materializing them.
 * Provisional chunks hidden as history-backed / replay duplicates of committed
 * chunks are NOT counted — the chat limit bounds what is on screen, and
 * counting invisible duplicates would unload real history to make room for them.
 */
export function selectRenderedCount(state: TranscriptState): number {
  const backed = historyBackedProvisional(state);
  const { skip, hideAccumulating } = committedOverlap(state);
  let count = state.committed.length;
  for (let i = skip; i < state.provisional.length; i++) {
    const p = state.provisional[i];
    if (p !== undefined && !backed.has(p)) count++;
  }
  if (state.accumulating !== null && !hideAccumulating) count++;
  return count;
}

/**
 * Select all chunks for rendering: committed first (seq order),
 * then provisional (seq: null), excluding history-backed identities. Unknown
 * accumulating content stays live, even if its text equals an earlier step.
 */
export function selectChunks(state: TranscriptState): readonly RenderedChunk[] {
  const result: RenderedChunk[] = [];
  const backed = historyBackedProvisional(state);
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
    if (p === undefined || backed.has(p)) continue;
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
