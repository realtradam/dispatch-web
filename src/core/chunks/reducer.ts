import type { AgentEvent, Chunk, ImageInput, Role, StoredChunk } from "@dispatch/wire";
import { assertChunkExhaustive } from "../wire/conformance";
import { historyBackedProvisional } from "./reconcile";
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
    providerRetry: null,
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
  // Also drop a stale `provider-retry` banner — a retry pending at disconnect
  // is stale once we re-subscribe (provider-retry events are not replayed), so
  // a finished turn must not keep showing a "retrying…" banner forever.
  return { ...state, generating: false, providerRetry: null };
}

function flushAccumulating(
  provisional: readonly ProvisionalChunk[],
  acc: AccumulatingChunk | null,
): readonly ProvisionalChunk[] {
  if (acc === null) return provisional;
  const chunk: Chunk =
    acc.kind === "text" ? { type: "text", text: acc.text } : { type: "thinking", text: acc.text };
  return [
    ...provisional,
    withTurn(
      { role: "assistant", chunk, ...(acc.stepId !== undefined ? { stepId: acc.stepId } : {}) },
      acc.turnId,
    ),
  ];
}

/** Attach a `turnId` to a provisional chunk (omitted when unknown). */
function withTurn(p: ProvisionalChunk, turnId: string | undefined): ProvisionalChunk {
  return turnId !== undefined ? { ...p, turnId } : p;
}

/**
 * Tag the trailing UNTAGGED user run (the sender's optimistic echo, appended
 * before the server assigned a turn id) with the turn that just started.
 */
function tagTrailingUserEcho(
  provisional: readonly ProvisionalChunk[],
  turnId: string,
): readonly ProvisionalChunk[] {
  let start = provisional.length;
  while (start > 0) {
    const p = provisional[start - 1];
    if (p === undefined || p.role !== "user" || p.turnId !== undefined) break;
    start--;
  }
  if (start === provisional.length) return provisional;
  return [
    ...provisional.slice(0, start),
    ...provisional.slice(start).map((p) => ({ ...p, turnId })),
  ];
}

/**
 * Drop the previous copy of a turn that is being replayed from its start.
 * Keeps the trailing user run — the opening this replay's `user-message` just
 * appended (or the sender's echo that `turn-start` just tagged) — and every
 * other turn's chunks.
 */
function dropReplayedTurn(
  provisional: readonly ProvisionalChunk[],
  turnId: string,
): readonly ProvisionalChunk[] {
  let tail = provisional.length;
  while (tail > 0 && provisional[tail - 1]?.role === "user") tail--;
  // A stale steering bubble (replayed again as its own `steering` event) can
  // end the old copy and so sit inside the trailing user run.
  const stale = (p: ProvisionalChunk, i: number): boolean =>
    p.turnId === turnId && (i < tail || p.afterToolCallId !== undefined);
  if (!provisional.some(stale)) return provisional;
  return provisional.filter((p, i) => !stale(p, i));
}

/**
 * Content equality for two chunks of the SAME role (used to de-dup an
 * optimistic echo against the authoritative committed version). Compares the
 * discriminating payload only — `stepId` (generation provenance) is ignored
 * since it is absent on provisional echoes but present on committed tool chunks.
 */
function chunkContentEquals(a: Chunk, b: Chunk): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "text": {
      const o = b as Extract<Chunk, { type: "text" }>;
      return a.text === o.text;
    }
    case "thinking": {
      const o = b as Extract<Chunk, { type: "thinking" }>;
      return a.text === o.text;
    }
    case "image": {
      const o = b as Extract<Chunk, { type: "image" }>;
      return a.url === o.url;
    }
    case "error": {
      const o = b as Extract<Chunk, { type: "error" }>;
      return a.message === o.message && a.code === o.code;
    }
    case "system": {
      const o = b as Extract<Chunk, { type: "system" }>;
      return a.text === o.text;
    }
    case "tool-call": {
      const o = b as Extract<Chunk, { type: "tool-call" }>;
      return a.toolCallId === o.toolCallId && a.toolName === o.toolName;
    }
    case "tool-result": {
      const o = b as Extract<Chunk, { type: "tool-result" }>;
      return a.toolCallId === o.toolCallId && a.toolName === o.toolName && a.isError === o.isError;
    }
    default:
      return assertChunkExhaustive(a) === assertChunkExhaustive(b);
  }
}

/**
 * The trailing run of consecutive same-role provisional chunks at the end of
 * `provisional` (the optimistic echo of one message). Returns the start/end
 * indices `[start, end)` into `provisional` (empty if none).
 */
function trailingRun(
  provisional: readonly ProvisionalChunk[],
  role: Role,
): readonly ProvisionalChunk[] {
  const end = provisional.length;
  let start = end;
  while (start > 0 && provisional[start - 1]?.role === role) start--;
  return provisional.slice(start, end);
}

/**
 * Merge authoritative seq-keyed chunks into the committed history.
 * Dedupes by seq (new wins), keeps seq-monotonic order, idempotent.
 * A sealed/finally-synced turn supersedes only its own provisional chunks;
 * unrelated turns and an already-running queued carry remain live.
 *
 * Chunks below the chat-limit unload watermark (`hiddenBeforeSeq`) are
 * REJECTED: a full-cache or tail merge must not resurrect what the trim
 * unloaded. Restoring earlier history goes through `restoreEarlier` instead.
 */
export function applyHistory(
  state: TranscriptState,
  chunks: readonly StoredChunk[],
  finishedTurnIds: readonly string[] = [],
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
  const identityRows = new Map(seqMap);
  for (const c of chunks) identityRows.set(c.seq, c);
  const backed = historyBackedProvisional(
    state,
    [...identityRows.values()].sort((a, b) => a.seq - b.seq),
  );
  const finished = new Set(finishedTurnIds);
  if (state.sealedTurnId !== null) finished.add(state.sealedTurnId);
  state = {
    ...state,
    provisional: state.provisional.filter((p) => !backed.has(p) && !finished.has(p.turnId ?? "")),
    accumulating:
      state.accumulating?.turnId !== undefined && finished.has(state.accumulating.turnId)
        ? null
        : state.accumulating,
  };

  if (state.sealedTurnId !== null) {
    // Legacy (non-recovery) histories may carry no turn provenance at all.
    // Retain their seal cleanup, but never erase an already-live queued carry.
    const legacySeal =
      (state.historyRecoveryTurnIds?.length ?? 0) === 0 && finishedTurnIds.length === 0;
    return {
      ...state,
      committed,
      provisional: legacySeal
        ? state.provisional.filter(
            (p) =>
              state.generating &&
              p.turnId === state.currentTurnId &&
              p.turnId !== state.sealedTurnId,
          )
        : state.provisional,
      accumulating:
        legacySeal && state.accumulating?.turnId === state.sealedTurnId ? null : state.accumulating,
      sealedTurnId: null,
      ...(state.historyRecoveryTurnIds !== undefined
        ? {
            historyRecoveryTurnIds: state.historyRecoveryTurnIds.filter(
              (id) => !finishedTurnIds.includes(id),
            ),
          }
        : {}),
    };
  }

  // During generation: if new committed chunks arrived, the provisional
  // array may contain duplicates — the optimistic echo from `appendUserMessage`
  // is now backed by committed chunks (CR-6: user message persisted at turn
  // start). A user message may be multi-chunk (`[text, image, image, …]`), so
  // match the trailing provisional user-run against the trailing committed
  // user-run by content equality and drop the whole echo when it is fully
  // backed. Leaves the accumulating (streaming) chunk untouched.
  if (
    addedNew &&
    state.generating &&
    state.provisional.length > 0 &&
    !state.provisional.some(
      (p) => p.turnId !== undefined && state.historyRecoveryTurnIds?.includes(p.turnId),
    )
  ) {
    const provRun = trailingRun(state.provisional, "user");
    if (provRun.length > 0) {
      const commRun = trailingRun(committed, "user");
      // Drop the provisional user echo iff every echoed chunk is content-equal
      // to the corresponding committed chunk (the server persisted the same
      // message). A partial match (echo longer than committed) keeps the echo
      // — the not-yet-committed tail stays until the turn seals.
      const fullyBacked =
        commRun.length >= provRun.length &&
        provRun.every((p, i) => {
          const c = commRun[i];
          return (
            c !== undefined &&
            (c.turnId === undefined || p.turnId === undefined || c.turnId === p.turnId) &&
            chunkContentEquals(p.chunk, c.chunk)
          );
        });
      if (fullyBacked) {
        const dropStart = state.provisional.length - provRun.length;
        const provisional = state.provisional.slice(0, dropStart);
        return { ...state, committed, provisional, accumulating: state.accumulating };
      }
    }
  }

  return {
    ...state,
    committed,
    ...(state.historyRecoveryTurnIds !== undefined
      ? {
          historyRecoveryTurnIds: state.historyRecoveryTurnIds.filter(
            (id) => !finishedTurnIds.includes(id),
          ),
        }
      : {}),
  };
}

/**
 * Fold one live AgentEvent into the provisional state.
 *
 * - `turn-start` records the turnId.
 * - `user-message` appends the turn's user prompt (de-duped vs the sender's
 *   optimistic echo) so a watcher renders it mid-turn.
 * - `text-delta` extends the current accumulating TextChunk (or starts one).
 * - `reasoning-delta` extends the current accumulating ThinkingChunk (or starts one).
 * - `reasoning-end` closes the open ThinkingChunk as its own chunk; with none open
 *   (a redacted/empty block) it appends an empty thinking chunk, mirroring history.
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
 *
 * NOTE: this is the inner reducer. The transient `provider-retry` banner is SET
 * here (on a `provider-retry` event) but CLEARED by the `foldEvent` wrapper
 * below, so the clearing logic stays centralized in one place.
 */
function reduceEvent(state: TranscriptState, event: AgentEvent): TranscriptState {
  switch (event.type) {
    case "status":
    case "tool-output":
      return state;

    case "turn-start": {
      // A turn starts exactly once live, so a `turn-start` for a turn that
      // already has provisional content is a late-join REPLAY restarting from
      // the top (re-subscribe after a tab switch / WS reconnect): the server
      // re-delivers the whole in-flight turn. Replace the stale copy instead of
      // appending a second one (a duplicate copy rendered as a tail of thinking
      // blocks with its tool cards collapsed onto the first copy's).
      const stale = state.accumulating?.turnId === event.turnId;
      const provisional = tagTrailingUserEcho(
        flushAccumulating(state.provisional, stale ? null : state.accumulating),
        event.turnId,
      );
      return {
        ...state,
        provisional: dropReplayedTurn(provisional, event.turnId),
        accumulating: null,
        currentTurnId: event.turnId,
        generating: true,
      };
    }

    case "user-message": {
      // The turn's USER prompt, surfaced on the event stream (backend CR-3) so a
      // WATCHER/late-joiner renders it mid-turn instead of waiting for seal. The
      // SENDER already echoed its own prompt optimistically (`appendUserMessage`),
      // so DE-DUP: skip if the trailing provisional USER run already contains an
      // identical user text chunk. The echo may be multi-chunk (`[text, image,
      // image, …]` — `appendUserMessage` appends the text first, then images), so
      // we scan the whole trailing user run, not just the last chunk (which would
      // be an image when images were pasted). A pure watcher has no such echo →
      // it appends and renders. The `user-message` event carries ONLY text (never
      // images — images arrive via history/loadSince); an images-only send (empty
      // text) emits no `user-message` and is not de-duped here.
      if (event.text.length === 0) return state;
      const run = trailingRun(state.provisional, "user");
      const echoed = run.find(
        (p) =>
          (p.turnId === undefined || p.turnId === event.turnId) &&
          p.chunk.type === "text" &&
          p.chunk.text === event.text,
      );
      if (echoed !== undefined) {
        return {
          ...state,
          // Preserve the live text independently of the local send. A delayed
          // queued ack may remove its images, but cannot erase this server event.
          provisional: tagTrailingUserEcho(state.provisional, event.turnId).map((p) => {
            if (p.chunk !== echoed.chunk) return p;
            const { localRequestId: _local, ...confirmed } = p;
            return { ...confirmed, opening: true };
          }),
          generating: true,
        };
      }
      const provisional = flushAccumulating(state.provisional, state.accumulating);
      return {
        ...state,
        provisional: [
          ...provisional,
          {
            role: "user",
            chunk: { type: "text", text: event.text },
            turnId: event.turnId,
            opening: true,
          },
        ],
        accumulating: null,
        generating: true,
      };
    }

    case "text-delta": {
      const acc = state.accumulating;
      if (acc !== null && acc.kind === "text" && acc.turnId === event.turnId) {
        return {
          ...state,
          accumulating: { ...acc, text: acc.text + event.delta },
          generating: true,
        };
      }
      const provisional = flushAccumulating(state.provisional, acc);
      return {
        ...state,
        provisional,
        accumulating: { kind: "text", text: event.delta, turnId: event.turnId },
        generating: true,
      };
    }

    case "reasoning-delta": {
      const acc = state.accumulating;
      if (acc !== null && acc.kind === "thinking" && acc.turnId === event.turnId) {
        return {
          ...state,
          accumulating: { ...acc, text: acc.text + event.delta },
          generating: true,
        };
      }
      const provisional = flushAccumulating(state.provisional, acc);
      return {
        ...state,
        provisional,
        accumulating: { kind: "thinking", text: event.delta, turnId: event.turnId },
        generating: true,
      };
    }

    case "reasoning-end": {
      const acc = state.accumulating;
      // Close the open thinking block of this turn: flush it as its own provisional chunk.
      if (acc !== null && acc.kind === "thinking" && acc.turnId === event.turnId) {
        return {
          ...state,
          provisional: flushAccumulating(state.provisional, acc),
          accumulating: null,
          generating: true,
        };
      }
      // No open thinking (a redacted/empty block with no deltas): history persists an
      // EMPTY thinking chunk for it, so mirror that 1:1.
      return {
        ...state,
        provisional: [
          ...flushAccumulating(state.provisional, acc),
          { role: "assistant", chunk: { type: "thinking", text: "" }, turnId: event.turnId },
        ],
        accumulating: null,
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
        provisional: [...provisional, { role: "assistant", chunk, turnId: event.turnId }],
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
        provisional: [...provisional, { role: "tool", chunk, turnId: event.turnId }],
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
        provisional: [...provisional, { role: "assistant", chunk, turnId: event.turnId }],
        accumulating: null,
        generating: false,
      };
    }

    case "usage":
      return { ...state, latestUsage: event.usage };

    case "step-complete":
      // A persistence boundary may lag this notification. Stamp provenance and
      // finish the generation chunk, but keep it until history really backs it.
      return {
        ...state,
        provisional: flushAccumulating(state.provisional, state.accumulating),
        accumulating: null,
      };

    case "turn-ended":
      return {
        ...state,
        provisional:
          state.accumulating?.turnId === event.turnId
            ? flushAccumulating(state.provisional, state.accumulating)
            : state.provisional,
        accumulating: state.accumulating?.turnId === event.turnId ? null : state.accumulating,
        generating: state.currentTurnId === event.turnId ? false : state.generating,
      };

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
      const preceding = [...state.committed, ...provisional]
        .reverse()
        .find((p) => p.turnId === event.turnId && p.chunk.type === "tool-result");
      const afterToolCallId =
        preceding?.chunk.type === "tool-result" ? preceding.chunk.toolCallId : undefined;
      return {
        ...state,
        provisional: [
          ...provisional,
          {
            role: "user",
            chunk: { type: "text", text: event.text },
            turnId: event.turnId,
            ...(afterToolCallId !== undefined ? { afterToolCallId } : {}),
          },
        ],
        accumulating: null,
        generating: true,
      };
    }

    case "provider-retry": {
      // TRANSIENT: a retryable provider error is being retried with backoff.
      // Coalesce — the latest attempt + delay replaces any previous, so a
      // single updating "retrying…" banner shows the newest. NOT a chunk: it
      // never enters provisional/committed, so it can never pollute the prompt
      // or be replayed on a reload. The turn is still in flight, so `generating`
      // (already true from `turn-start`) is left untouched.
      return { ...state, providerRetry: event };
    }

    default:
      return state; // Forward-compatible with additive wire events.
  }
}

/**
 * Fold one live AgentEvent into the transcript state. Wraps `reduceEvent` to
 * centralize the TRANSIENT `provider-retry` banner's clearing: the banner is
 * SET by `reduceEvent` on a `provider-retry` event (coalescing), and CLEARED
 * here when the model's content resumes (the retry succeeded) or the turn ends
 * (done/sealed/error) or a new turn starts. Metadata/no-op events
 * (`status`/`tool-output`/`usage`/`step-complete`) leave a showing banner
 * untouched. The `state.providerRetry !== null` guard keeps the common path
 * (no banner pending) identity-stable — no needless new object.
 */
// Events that clear a showing provider-retry banner (content resumed or turn ended).
const RETRY_CLEARING_EVENTS: ReadonlySet<AgentEvent["type"]> = new Set([
  "turn-start",
  "text-delta",
  "reasoning-delta",
  "reasoning-end",
  "tool-call",
  "tool-result",
  "error",
  "done",
  "turn-sealed",
  "turn-ended",
]);

export function foldEvent(state: TranscriptState, event: AgentEvent): TranscriptState {
  if (
    event.type === "tool-call" ||
    event.type === "tool-result" ||
    event.type === "step-complete"
  ) {
    state = {
      ...state,
      provisional: state.provisional.map((p) =>
        p.turnId === event.turnId &&
        p.role === "assistant" &&
        p.stepId === undefined &&
        (p.chunk.type === "text" || p.chunk.type === "thinking")
          ? { ...p, stepId: event.stepId }
          : p,
      ),
      accumulating:
        state.accumulating?.turnId === event.turnId
          ? { ...state.accumulating, stepId: event.stepId }
          : state.accumulating,
    };
  }
  const next = reduceEvent(state, event);
  if (event.type === "provider-retry") return next; // set by reduceEvent; not a clearing event
  if (RETRY_CLEARING_EVENTS.has(event.type) && state.providerRetry !== null) {
    return { ...next, providerRetry: null };
  }
  return next;
}

/**
 * Optimistically append a user message to the provisional list.
 * Flushes any in-progress accumulating chunk first (defensively).
 * The provisional user chunks are superseded when applyHistory receives
 * the authoritative committed chunks after a turn seals.
 *
 * When `images` are provided, they are appended AFTER the text chunk (in
 * order) as `image` chunks — matching the server's persisted layout
 * (`[text, image, image, …]` in one user message). A text chunk is only
 * appended when `text` is non-empty (an images-only send echoes just the
 * images). The `user-message` event carries only text (never images), so its
 * de-dup scans the trailing user run for the echoed text rather than just the
 * last chunk.
 */
export function appendUserMessage(
  state: TranscriptState,
  text: string,
  images?: readonly ImageInput[],
  localRequestId?: string,
): TranscriptState {
  const provisional = flushAccumulating(state.provisional, state.accumulating);
  const userChunks: Chunk[] = [];
  if (text.length > 0) userChunks.push({ type: "text", text });
  if (images !== undefined) {
    for (const img of images) {
      if (img.url.length === 0) continue;
      const chunk: Chunk =
        img.mimeType !== undefined
          ? { type: "image", url: img.url, mimeType: img.mimeType }
          : { type: "image", url: img.url };
      userChunks.push(chunk);
    }
  }
  if (userChunks.length === 0) {
    // Nothing to echo (empty text + no images) — leave state unchanged but
    // still flush any accumulating chunk defensively.
    return { ...state, provisional, accumulating: null };
  }
  return {
    ...state,
    provisional: [
      ...provisional,
      ...userChunks.map(
        (chunk) =>
          ({
            role: "user",
            chunk,
            ...(localRequestId !== undefined ? { localRequestId } : {}),
          }) as const,
      ),
    ],
    accumulating: null,
  };
}

/** Remove only still-local artifacts of one accepted queued send; never history/live text. */
export function removeLocalEcho(state: TranscriptState, requestId: string): TranscriptState {
  const provisional = state.provisional.filter((p) => p.localRequestId !== requestId);
  return provisional.length === state.provisional.length ? state : { ...state, provisional };
}

/** A resync notice is lifecycle evidence, never fabricated transcript content. */
export function markHistoryRecovering(state: TranscriptState, turnId: string): TranscriptState {
  return {
    ...state,
    currentTurnId: turnId,
    generating: true,
    historyRecoveryTurnIds: state.historyRecoveryTurnIds?.includes(turnId)
      ? state.historyRecoveryTurnIds
      : [...(state.historyRecoveryTurnIds ?? []), turnId],
  };
}
