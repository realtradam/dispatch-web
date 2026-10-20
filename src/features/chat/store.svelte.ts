import type {
  ChatDeltaMessage,
  ChatErrorMessage,
  ChatQueueCancelMessage,
  ChatQueueMessage,
  ChatSendMessage,
} from "@dispatch/transport-contract";
import type { ChatMessage, ImageInput, StoredChunk, TurnProviderRetryEvent } from "@dispatch/wire";
import type { RenderedChunk, TranscriptState } from "../../core/chunks";
import {
  appendUserMessage,
  applyHistory,
  clearGenerating,
  foldEvent,
  initialState,
  initialWindowSize,
  normalizeChatLimit,
  restoreEarlier,
  selectChunks,
  selectGenerating,
  selectHasEarlier,
  selectMessages,
  selectProviderRetry,
  trimTranscript,
  unloadCount,
  windowTranscript,
} from "../../core/chunks";
import type { CacheTimerState, MetricsState, TurnMetricsEntry } from "../../core/metrics";
import {
  applyDurableMetrics,
  foldCacheTimerEvent,
  foldMetricsEvent,
  initialCacheTimerState,
  initialMetricsState,
  seedTurnGap,
  selectCurrentContextSize,
  selectOrderedTurnMetrics,
  stopTurnGap,
} from "../../core/metrics";
import type { ConversationCache } from "../conversation-cache";
import type { NamedAgentSelectionSnapshot } from "../named-agents";
import type { ChatTransport, HistorySync, MetricsSync } from "./ports";

export interface ChatStoreDependencies {
  readonly conversationId: string;
  readonly model?: string;
  readonly transport: ChatTransport;
  readonly historySync: HistorySync;
  readonly metricsSync: MetricsSync;
  readonly cache: ConversationCache;
  /**
   * The workspace this conversation belongs to (its URL slug). Sent on
   * `chat.send`/`chat.queue` so the backend stamps the conversation's workspace
   * at creation (default "default"). Absent → omitted (legacy behavior).
   */
  readonly workspaceId?: string;
  /**
   * The chat limit: max loaded chunks before the oldest quarter is unloaded
   * (see `core/chunks/trim.ts`). Normalized via `normalizeChatLimit`; absent →
   * `DEFAULT_CHAT_LIMIT`.
   */
  readonly chatLimit?: number;
  /**
   * Whether unloading may run RIGHT NOW. The composition root wires this to the
   * smart-scroll "stuck to bottom" state: while the reader is scrolled up, a
   * trim would yank the content under them, so it is DEFERRED until they return
   * to the bottom (the next fold retries). Absent → always allowed.
   */
  readonly canUnload?: () => boolean;
  /**
   * Called when a swallowed error should be surfaced to the user (e.g. a
   * metrics sync failure). Wired by the composition root to the app store's
   * `reportError` → full-screen error modal. Absent → errors are logged only.
   */
  readonly onError?: (context: string, err: unknown) => void;
  /**
   * Schedules a deferred flush of buffered live events (e.g. once per animation
   * frame). When provided, `handleDelta` QUEUES events and folds the whole batch
   * in one pass on the scheduled callback — so a burst (the late-join replay on
   * opening a conversation mid-turn, or a fast stream on a slow device) costs ONE
   * derivation + render instead of one per WS frame. Absent → every event is
   * folded synchronously (the original behavior; used by tests).
   */
  readonly scheduleFlush?: (flush: () => void) => void;
  /** Wall clock (epoch ms) — times the cache-timer gaps. Absent → `Date.now`. */
  readonly now?: () => number;
}

export interface ChatStore {
  readonly messages: readonly ChatMessage[];
  readonly chunks: readonly RenderedChunk[];
  readonly turnMetrics: readonly TurnMetricsEntry[];
  /**
   * The conversation's current context size (tokens occupied) — updated
   * PROGRESSIVELY: during an in-flight turn, the most recent step's
   * `inputTokens + outputTokens` (each step's input already includes all prior
   * context); once the turn seals, its authoritative `contextSize`. `undefined`
   * ("unknown") when no step has reported usage yet. Never `0` for the unknown
   * case.
   */
  readonly currentContextSize: number | undefined;
  /**
   * Whether a turn is currently generating server-side — derived from the event
   * stream (`turn-start`…no-`done`/`turn-sealed`-yet). True for ANY watching
   * client: the sender, a second device, or a reconnected client whose in-flight
   * turn was replayed. Drives the composer's "generating…" indicator.
   */
  readonly generating: boolean;
  /**
   * The latest `provider-retry` event for the current turn, or `null` when no
   * retry is pending. Drives the transient yellow "retrying…" warning banner —
   * never persisted (never sent to the model or replayed on reload). Coalesces
   * to the newest attempt + delay; cleared when content resumes or the turn ends.
   */
  readonly providerRetry: TurnProviderRetryEvent | null;
  readonly pendingSync: boolean;
  readonly error: string | null;
  readonly model: string | undefined;
  /**
   * Whether earlier history was unloaded by the chat limit (or never loaded by
   * the fresh-load window) and can be paged back in — drives the
   * "Show earlier messages" affordance.
   */
  readonly hasEarlier: boolean;
  /**
   * Render-key base for thinking collapses: how many thinking chunks are
   * unloaded below the watermark, so the UI's ordinal keys stay stable across
   * a trim (see `TranscriptState.hiddenThinkingCount`).
   */
  readonly thinkingKeyBase: number;
  /**
   * The cache timer (see `core/metrics/cache-timer.ts`): the running gap
   * between model requests (a step's tools executing, or the wait after a turn
   * ended) plus the stamped durations of finished gaps, keyed by `stepId` /
   * `turnId`. Timed with the local clock from live events; in-memory only (a
   * reload keeps just a turn gap seeded via `noteLastActivity`).
   */
  readonly cacheTimer: CacheTimerState;
  /**
   * Seed the turn gap from an authoritative activity timestamp (the
   * conversation list's `lastActivityAt`) — call only for an IDLE conversation.
   * Ignored while a turn is generating; a running turn gap keeps the later start.
   */
  noteLastActivity(at: number): void;
  handleDelta(msg: ChatDeltaMessage | ChatErrorMessage): void;
  /**
   * Send a user message (start a turn via `chat.send`). Optimistically echoes
   * the text + any `images` as provisional user chunks (`[text, image, …]` in
   * order), then forwards them on the WS `chat.send` op. `images` is omitted on
   * the wire when none are staged (text-only, backward compatible). An
   * images-only send (empty text) is allowed — the message text is `""`.
   */
  send(text: string, images?: readonly ImageInput[]): void;
  /**
   * Enqueue a steering message onto the conversation's queue (`chat.queue`
   * WS op). While a turn is generating, the message is delivered mid-turn at
   * the next tool-result boundary (a `steering` `AgentEvent` fires + the
   * message-queue surface updates). When no turn is active, the server
   * auto-starts a turn with the message as its opening prompt (equivalent to
   * `chat.send`). No optimistic transcript echo — the queue SURFACE carries the
   * pending message until drain; the `steering` event places it in the
   * transcript. Empty `text` is allowed when images are supplied. WS delivery
   * is fire-and-forget; transport send is not a persistence acknowledgement.
   */
  queueMessage(text: string, images?: readonly ImageInput[]): void;
  /**
   * Cancel (remove) a single queued steering message by id so it never runs
   * (`chat.queue.cancel` WS op). Fire-and-forget + idempotent: success is
   * confirmed by the `message-queue` SURFACE updating (the cancelled message
   * leaves the snapshot); a cancel of an already-drained / unknown message is a
   * silent server-side no-op. The caller optimistically hides the row; the
   * surface update reconciles. `messageId` is the stable `QueuedMessage.id`
   * the queue surface snapshot carries. No transcript change — a cancelled
   * message is never delivered as steering.
   */
  cancelQueuedMessage(messageId: string): void;
  setModel(model: string): void;
  /**
   * Set (or clear, with null) the Named Agent selection snapshot this chat sends
   * with `chat.send` (plan §7). The backend persists it on the conversation at
   * creation so it freezes the friendly id/name + resolved model — later edits to
   * the Named Agent do not change this conversation's selection. The raw model
   * (already set via `setModel`) is sent alongside; the snapshot is display/identity
   * metadata that preserves HOW it was selected.
   */
  setNamedAgent(snapshot: NamedAgentSelectionSnapshot | null): void;
  /**
   * Update the chat limit LIVE: re-normalizes, then adjusts the loaded window.
   * Lowering it unloads older committed chunks (deferred via the gate while the
   * reader is scrolled up, catching up on the next mutation). Raising it
   * REFILLS older history (cache first, then CR-5 `?beforeSeq=`) up to the
   * fresh-load window (`initialWindowSize` = 75% of the limit) — the same
   * window a fresh `load()` would show — so upping the limit reveals more
   * history instead of leaving a partial view. New deltas + loads use the new
   * limit. The refill awaits, so a caller can preserve scroll over the prepend.
   */
  setChatLimit(limit: number): Promise<void>;
  load(): Promise<void>;
  /**
   * Page one unload-unit (`ceil(limit/4)`) of earlier history back in — the
   * "Show earlier messages" action. Local cache first; when the cache doesn't
   * reach far enough back (a server-windowed fresh load), the missing older
   * run is fetched via CR-5 `?beforeSeq=&limit=` and persisted to the cache.
   */
  showEarlier(): Promise<void>;
  /**
   * Re-sync after a WS (re)connect. Clears any stale `generating` (a turn may
   * have sealed while disconnected — the live `turn-sealed` was missed), then
   * pulls newly-sealed turns from history (+ metrics). If the turn is still
   * running, the server's post-subscribe replay re-asserts `generating`. The
   * app store pairs this with a `chat.subscribe` for the conversation.
   */
  resync(historyEpoch?: number): void;
  /** Discard pre-replacement transcript state without loading an unseen conversation. */
  invalidateHistory(historyEpoch: number): void;
  dispose(): void;
}

export function createChatStore(deps: ChatStoreDependencies): ChatStore {
  let transcript = $state<TranscriptState>(initialState());
  let metrics = $state<MetricsState>(initialMetricsState());
  let _pendingSync = $state(false);
  let _error = $state<string | null>(null);
  let _model = $state<string | undefined>(deps.model);
  let _namedAgent = $state<NamedAgentSelectionSnapshot | null>(null);
  let cacheTimer = $state<CacheTimerState>(initialCacheTimerState());
  const now = deps.now ?? Date.now;
  let disposed = false;
  let rerunRequested = false;
  let historyEpoch: number | undefined;
  let revision = 0;
  let reloadWindow = false;
  let earliestSeq = $state<number | null>(null);

  function resetTranscript(epoch: number): void {
    historyEpoch = epoch;
    revision++;
    reloadWindow = true;
    transcript = initialState();
    earliestSeq = null;
    pendingEvents = [];
  }
  function hasEarlier(): boolean {
    return selectHasEarlier(transcript, earliestSeq);
  }

  /** The most recent turn's id (resolves a seeded turn gap when it is stamped). */
  function lastTurnIdOf(m: MetricsState): string | undefined {
    const entries = selectOrderedTurnMetrics(m);
    return entries[entries.length - 1]?.turnId;
  }

  let chatLimit = normalizeChatLimit(deps.chatLimit);

  // Memoized projections, keyed by state-object identity (the reducers are
  // immutable, so identity == content). The getters are read several times per
  // render (ChatPane + ChatView); returning the SAME array for an unchanged
  // state keeps downstream `$derived`s (grouping, metrics placement) from
  // recomputing on every read. Plain closures, not `$derived` — a store factory
  // may run inside a component effect, which would own (and later destroy) it.
  const memo = <S, R>(fn: (s: S) => R): ((s: S) => R) => {
    let lastIn: S | undefined;
    let lastOut: R | undefined;
    return (s) => {
      if (lastOut === undefined || s !== lastIn) {
        lastIn = s;
        lastOut = fn(s);
      }
      return lastOut;
    };
  };
  const chunksOf = memo(selectChunks);
  const turnMetricsOf = memo(selectOrderedTurnMetrics);

  // Buffered live events awaiting a scheduled flush (see `scheduleFlush`).
  let pendingEvents: ChatDeltaMessage["event"][] = [];
  let flushScheduled = false;

  /** Fold every buffered event in one pass, then trim + sync once. */
  function flushEvents(): void {
    flushScheduled = false;
    if (disposed || pendingEvents.length === 0) return;
    const batch = pendingEvents;
    pendingEvents = [];
    applyEvents(batch);
  }

  function applyEvents(events: readonly ChatDeltaMessage["event"][]): void {
    let t = transcript;
    let m = metrics;
    let sealed = false;
    let failed = false;
    let c = cacheTimer;
    const at = now();
    for (const event of events) {
      t = foldEvent(t, event);
      m = foldMetricsEvent(m, event);
      const mNow = m;
      c = foldCacheTimerEvent(c, event, at, () => lastTurnIdOf(mNow));
      if (t.sealedTurnId !== null) sealed = true;
      else if (event.type === "error") failed = true;
    }
    transcript = t;
    metrics = m;
    cacheTimer = c;
    maybeTrim();
    if (sealed) {
      void syncTail();
      void syncMetrics();
    } else if (failed) {
      // A turn that FAILS never seals, but the backend still persists the
      // metrics it accumulated — pull them so the turn gets its row.
      void syncMetrics();
    }
  }

  /**
   * Enforce the chat limit after a transcript mutation — unless the injected
   * gate says the reader is scrolled up (then defer; the next mutation retries
   * and `trimTranscript` unloads whole quarters to catch up).
   */
  function maybeTrim(): void {
    if (deps.canUnload !== undefined && !deps.canUnload()) return;
    transcript = trimTranscript(transcript, chatLimit);
  }

  /**
   * Pull `seq > cache-cursor` from the server and fold it in. `coldLimit`, when
   * given AND the cache is empty (a truly fresh browser), windows the fetch to
   * the newest N chunks (CR-5 `?limit=`) so a huge conversation doesn't ship
   * whole. It is deliberately NOT applied to a warm-cache tail: windowing a
   * tail that grew past N while we were away would leave a silent seq GAP
   * between the cache and the fetched window.
   */
  async function syncTail(coldLimit?: number): Promise<void> {
    if (disposed) return;
    if (_pendingSync) {
      rerunRequested = true;
      return;
    }
    _pendingSync = true;
    do {
      rerunRequested = false;
      try {
        const currentRevision = revision;
        const cachedEpoch = await deps.cache.historyEpoch(deps.conversationId);
        if (historyEpoch !== undefined && cachedEpoch !== historyEpoch)
          await deps.cache.reset(deps.conversationId, historyEpoch);
        const since =
          cachedEpoch === undefined ? 0 : await deps.cache.sinceSeq(deps.conversationId);
        const limit =
          since === 0 ? (reloadWindow ? initialWindowSize(chatLimit) : coldLimit) : undefined;
        const res = await deps.historySync(
          deps.conversationId,
          since,
          limit === undefined ? undefined : { limit },
        );
        if (disposed) break;
        if (revision !== currentRevision) {
          rerunRequested = true;
          continue;
        }
        if (
          (cachedEpoch !== undefined && cachedEpoch !== res.historyEpoch) ||
          (historyEpoch !== undefined && historyEpoch !== res.historyEpoch)
        ) {
          resetTranscript(res.historyEpoch);
          await deps.cache.reset(deps.conversationId, res.historyEpoch);
          if (since !== 0) {
            rerunRequested = true;
            continue;
          }
        }
        reloadWindow = false;
        historyEpoch = res.historyEpoch;
        const merged = await deps.cache.commit(deps.conversationId, res.chunks, res.historyEpoch);
        if (disposed || historyEpoch !== res.historyEpoch) continue;
        if (since === 0 && (limit === undefined || res.chunks.length < limit))
          earliestSeq = merged[0]?.seq ?? 0;
        transcript = applyHistory(transcript, merged);
        maybeTrim();
        _error = null;
      } catch (err) {
        _error = err instanceof Error ? err.message : String(err);
      }
    } while (rerunRequested && !disposed);
    _pendingSync = false;
  }

  async function syncMetrics(): Promise<void> {
    if (disposed) return;
    try {
      const res = await deps.metricsSync(deps.conversationId);
      metrics = applyDurableMetrics(metrics, res.turns);
    } catch (err) {
      // Metrics fetch failure must not block history sync or throw;
      // live-folded metrics remain intact. Surface via onError (modal).
      console.error("[syncMetrics] failed:", err);
      deps.onError?.("Failed to sync conversation metrics", err);
    }
  }

  /**
   * Fetch up to `want` older chunks (seq < `oldest`) — cache first, then a
   * CR-5 `?beforeSeq=&limit=` server backfill when the cache is too shallow,
   * persisting it so the next read is local. Returns every locally-known
   * chunk older than `oldest` (the caller — `restoreEarlier` — takes the
   * newest `count` of them). Shared by `showEarlier` and the raise-refill.
   */
  async function backfillOlder(oldest: number, want: number): Promise<readonly StoredChunk[]> {
    const currentRevision = revision;
    let earlier = (await deps.cache.load(deps.conversationId)).filter((c) => c.seq < oldest);
    if (disposed || revision !== currentRevision) return [];
    const oldestKnown = earlier[0]?.seq ?? oldest;
    if (earlier.length < want && (earliestSeq === null || oldestKnown > earliestSeq)) {
      const res = await deps.historySync(deps.conversationId, 0, {
        beforeSeq: oldestKnown,
        limit: want - earlier.length,
      });
      if (disposed || revision !== currentRevision) return [];
      if (res.historyEpoch !== historyEpoch) {
        resetTranscript(res.historyEpoch);
        await deps.cache.reset(deps.conversationId, res.historyEpoch);
        await syncTail(initialWindowSize(chatLimit));
        return [];
      }
      const merged = await deps.cache.commit(deps.conversationId, res.chunks, res.historyEpoch);
      if (disposed || revision !== currentRevision) return [];
      if (res.chunks.length < want - earlier.length) earliestSeq = merged[0]?.seq ?? 0;
      earlier = merged.filter((c) => c.seq < oldest);
    }
    return earlier;
  }

  /**
   * Refill toward the fresh-load window after a limit RAISE: pull older
   * history (cache first, then server) so the loaded set grows to match what a
   * fresh `load()` would show at the new limit. No-op when already at the
   * known history boundary or already within the window. `restoreEarlier` re-derives
   * the window start at apply time, so a delta landing during the await can't
   * corrupt the merge. NOT gated (refilling prepends above the viewport; the
   * caller preserves scroll position).
   */
  async function refill(): Promise<void> {
    if (disposed) return;
    if (!hasEarlier()) return;
    const oldest = transcript.committed[0]?.seq ?? transcript.hiddenBeforeSeq;
    const want = initialWindowSize(chatLimit) - transcript.committed.length;
    if (want <= 0) return;
    try {
      const earlier = await backfillOlder(oldest, want);
      if (earlier.length === 0) return;
      transcript = restoreEarlier(transcript, earlier, want);
      _error = null;
    } catch (err) {
      _error = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    get messages(): readonly ChatMessage[] {
      return selectMessages(transcript);
    },
    get chunks(): readonly RenderedChunk[] {
      return chunksOf(transcript);
    },
    get turnMetrics(): readonly TurnMetricsEntry[] {
      return turnMetricsOf(metrics);
    },
    get currentContextSize(): number | undefined {
      return selectCurrentContextSize(metrics);
    },
    get generating(): boolean {
      return selectGenerating(transcript);
    },
    get providerRetry(): TurnProviderRetryEvent | null {
      return selectProviderRetry(transcript);
    },
    get pendingSync(): boolean {
      return _pendingSync;
    },
    get error(): string | null {
      return _error;
    },
    get model(): string | undefined {
      return _model;
    },
    get hasEarlier(): boolean {
      return hasEarlier();
    },
    get thinkingKeyBase(): number {
      return transcript.hiddenThinkingCount;
    },
    get cacheTimer(): CacheTimerState {
      return cacheTimer;
    },

    noteLastActivity(at: number): void {
      if (selectGenerating(transcript)) return;
      cacheTimer = seedTurnGap(cacheTimer, at);
    },

    handleDelta(msg: ChatDeltaMessage | ChatErrorMessage): void {
      if (msg.type === "chat.error") {
        if (msg.conversationId !== undefined && msg.conversationId !== deps.conversationId) {
          return;
        }
        _error = msg.message;
        return;
      }
      if (msg.event.conversationId !== deps.conversationId) {
        return;
      }
      if (deps.scheduleFlush === undefined) {
        applyEvents([msg.event]);
        return;
      }
      pendingEvents.push(msg.event);
      if (!flushScheduled) {
        flushScheduled = true;
        deps.scheduleFlush(flushEvents);
      }
    },

    send(text: string, images?: readonly ImageInput[]): void {
      flushEvents();
      // Sending ends the wait since the last turn: stamp it on that turn.
      cacheTimer = stopTurnGap(cacheTimer, now(), () => lastTurnIdOf(metrics));
      transcript = appendUserMessage(transcript, text, images);
      maybeTrim();
      const msg: ChatSendMessage = {
        type: "chat.send",
        conversationId: deps.conversationId,
        message: text,
        ...(_model !== undefined ? { model: _model } : {}),
        ...(_namedAgent !== null ? { namedAgent: _namedAgent } : {}),
        ...(deps.workspaceId !== undefined ? { workspaceId: deps.workspaceId } : {}),
        ...(images !== undefined && images.length > 0 ? { images: [...images] } : {}),
      };
      deps.transport.send(msg);
    },

    queueMessage(text: string, images?: readonly ImageInput[]): void {
      const trimmed = text.trim();
      if (trimmed.length === 0 && !images?.length) return;
      const msg: ChatQueueMessage = {
        type: "chat.queue",
        conversationId: deps.conversationId,
        text: trimmed,
        ...(images !== undefined && images.length > 0 ? { images: [...images] } : {}),
        ...(deps.workspaceId !== undefined ? { workspaceId: deps.workspaceId } : {}),
      };
      deps.transport.send(msg);
    },

    cancelQueuedMessage(messageId: string): void {
      // Fire-and-forget + idempotent (per the contract). The caller optimistically
      // hides the row; the message-queue surface update reconciles. A cancel of
      // an already-drained / unknown message is a silent server no-op, so there
      // is no local-state change to make and nothing to roll back on a stray
      // `chat.error` (which only fires for a malformed send — a client that
      // sends the id it just rendered never hits it).
      const msg: ChatQueueCancelMessage = {
        type: "chat.queue.cancel",
        conversationId: deps.conversationId,
        messageId,
      };
      deps.transport.send(msg);
    },

    setModel(model: string): void {
      _model = model;
    },

    setNamedAgent(snapshot: NamedAgentSelectionSnapshot | null): void {
      _namedAgent = snapshot;
    },

    async setChatLimit(limit: number): Promise<void> {
      const prev = chatLimit;
      chatLimit = normalizeChatLimit(limit);
      if (chatLimit < prev) {
        maybeTrim();
      } else if (chatLimit > prev) {
        await refill();
      }
    },

    async load(): Promise<void> {
      // Fresh load shows only the newest 75% of the limit — headroom before the
      // first trim. A warm cache is windowed locally (synchronously with its
      // apply — no render in between); a COLD cache passes the window to the
      // server instead (CR-5 `?limit=`), so a huge conversation never ships
      // whole. The post-sync window re-asserts the cap either way.
      const windowSize = initialWindowSize(chatLimit);
      const currentRevision = revision;
      const cachedEpoch = await deps.cache.historyEpoch(deps.conversationId);
      const cached = await deps.cache.load(deps.conversationId);
      if (!disposed && revision === currentRevision && cachedEpoch !== undefined) {
        historyEpoch = cachedEpoch;
        transcript = windowTranscript(applyHistory(transcript, cached), windowSize);
      }
      await syncTail(windowSize);
      transcript = windowTranscript(transcript, windowSize);
      await syncMetrics();
    },

    async showEarlier(): Promise<void> {
      if (disposed) return;
      const oldest = transcript.committed[0]?.seq ?? transcript.hiddenBeforeSeq;
      if (!hasEarlier()) return;
      const want = unloadCount(chatLimit);
      try {
        const earlier = await backfillOlder(oldest, want);
        transcript = restoreEarlier(transcript, earlier, want);
        _error = null;
      } catch (err) {
        _error = err instanceof Error ? err.message : String(err);
      }
    },

    invalidateHistory(epoch): void {
      if (!disposed && (historyEpoch === undefined || epoch > historyEpoch)) resetTranscript(epoch);
    },

    resync(epoch?: number): void {
      if (disposed) return;
      if (epoch !== undefined && (historyEpoch === undefined || epoch > historyEpoch))
        resetTranscript(epoch);
      // A turn may have sealed while we were disconnected (missed `turn-sealed`):
      // clear the now-stale spinner BEFORE re-subscribing, so a finished turn
      // doesn't spin forever. A still-running turn's replay re-asserts it.
      flushEvents();
      transcript = clearGenerating(transcript);
      void syncTail();
      void syncMetrics();
    },

    dispose(): void {
      disposed = true;
      pendingEvents = [];
    },
  };
}
