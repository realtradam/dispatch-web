<script lang="ts">
  import type { TurnProviderRetryEvent } from "@dispatch/wire";
  import { groupRenderedChunks, resolveImageUrl, type RenderedChunk, viewProviderRetry } from "../index";
  import {
    type CacheTimerState,
    interleaveTurnMetrics,
    lastTurnRowIndex,
    viewCacheRate,
    viewExpectedCache,
    viewStepMetrics,
    viewTurnMetrics,
    type TurnMetricsEntry,
  } from "../../../core/metrics";
  import { Markdown } from "../../markdown";
  import CacheTimerBadge from "./CacheTimerBadge.svelte";
  import LazyCollapse from "./LazyCollapse.svelte";
  import ToolCard from "./ToolCard.svelte";

  const badgeClass = {
    success: "badge-success",
    warning: "badge-warning",
    error: "badge-error",
  } as const;

  let {
    chunks,
    turnMetrics = [],
    hasEarlier = false,
    onShowEarlier,
    thinkingKeyBase = 0,
    providerRetry = null,
    apiBaseUrl = "",
    cwd = null,
    cacheTimer = null,
  }: {
    chunks: readonly RenderedChunk[];
    turnMetrics?: readonly TurnMetricsEntry[];
    /** Earlier history is unloaded (chat limit) and can be paged back in. */
    hasEarlier?: boolean;
    /** Page earlier history back in; the caller owns scroll-position preservation. */
    onShowEarlier?: () => Promise<void>;
    /**
     * Ordinal base for thinking-collapse keys: the count of thinking chunks
     * unloaded by the chat limit, so the remaining ordinals don't shift (and
     * swap collapse state) when a trim removes older thinking blocks.
     */
    thinkingKeyBase?: number;
    /**
     * The latest `provider-retry` event for the current turn, or `null` when
     * no retry is pending → renders the transient yellow "retrying…" banner.
     * Never persisted (never part of the message history); coalesces to the
     * newest attempt + delay, and is cleared when content resumes / turn ends.
     */
    providerRetry?: TurnProviderRetryEvent | null;
    /**
     * The HTTP API base URL (e.g. `http://localhost:24203`). Persisted image
     * chunks carry a compact relative path (`/images/<conv>/<uuid>.png`); this
     * base is prepended to render them. The optimistic echo's data URL and any
     * absolute URL pass through unchanged (see `resolveImageUrl`). Defaults to
     * "" (root-relative — a browser resolves `/images/…` against its origin).
     */
    apiBaseUrl?: string;
    /**
     * The active conversation's working directory (null when unset). Relative
     * Markdown image srcs (`![x](shot.png)`) resolve against it; local absolute
     * and `file://` paths do not need it. Passed to `Markdown` with `apiBaseUrl`.
     */
    cwd?: string | null;
    /**
     * The cache timer (gaps between model requests): a running step gap shows
     * live at the bottom (under the executing tools), a running turn gap live
     * on that turn's metrics row; finished gaps are stamped on their step /
     * turn metrics line. `null` (the default) hides it entirely — the caller
     * gates on the model.
     */
    cacheTimer?: CacheTimerState | null;
  } = $props();

  // True while a show-earlier page-in is awaited (disables the button).
  let loadingEarlier = $state(false);
  let failedImages = $state<string[]>([]);

  async function showEarlier() {
    if (!onShowEarlier || loadingEarlier) return;
    loadingEarlier = true;
    try {
      await onShowEarlier();
    } finally {
      loadingEarlier = false;
    }
  }

  const groups = $derived(groupRenderedChunks(chunks));

  const rows = $derived(interleaveTurnMetrics(groups, turnMetrics));

  // A SEEDED turn gap (no turnId — e.g. after a reload) renders on the most
  // recent turn's row (when no user message follows it).
  const seededTurnRow = $derived(
    cacheTimer?.running?.kind === "turn" && cacheTimer.running.turnId === null
      ? lastTurnRowIndex(rows)
      : null,
  );

  /** Start of the running turn gap if it belongs on this turn row, else undefined. */
  function liveTurnSince(turnId: string, rowIndex: number): number | undefined {
    const r = cacheTimer?.running;
    if (r?.kind !== "turn") return undefined;
    if (r.turnId === turnId || (r.turnId === null && rowIndex === seededTurnRow)) {
      return r.startedAt;
    }
    return undefined;
  }

  // A running step gap with tool calls → the live timer under the executing tools.
  const liveStepGap = $derived(
    cacheTimer?.running?.kind === "step" && cacheTimer.running.toolCount > 0
      ? cacheTimer.running
      : null,
  );

  // Tool cards use toolCallId keys across pending/result/seal and orphan page-in.
  // Stable per-row keys. Thinking blocks get an ordinal key (`think<n>`) that
  // survives the provisional→committed (seq null → seq N) transition, so the
  // collapse's open/close state is NOT lost when a turn seals. The ordinal
  // starts at `thinkingKeyBase` so keys also survive a chat-limit trim removing
  // older thinking blocks. (App isolates these keys per conversation via {#key}.)
  const keyedRows = $derived.by(() => {
    let thinking = thinkingKeyBase;
    return rows.map((row, i) => {
      if (row.kind === "step-metrics") {
        return { row, key: `s${row.step.stepId}` };
      }
      if (row.kind === "turn-metrics") {
        return { row, key: `m${row.turn.turnId}` };
      }
      const group = row.group;
      let key: string;
      if (group.kind === "tool") {
        key = `t${group.entry.toolCallId}`;
      } else if (group.chunk.chunk.type === "thinking") {
        key = `think${thinking++}`;
      } else if (group.chunk.seq != null) {
        key = `c${group.chunk.seq}`;
      } else {
        key = `p${i}`;
      }
      return { row, key };
    });
  });
</script>

{#snippet chunkRow(rendered: RenderedChunk)}
  {#if rendered.role === "user"}
    <!-- User: a speech bubble, left-aligned. A user message may be multi-chunk
         ([text, image, image, …]); each chunk renders in its own bubble. A
         persisted image chunk's url is a compact relative path (`/images/…`)
         served by the backend — resolve it against the API base. The
         optimistic echo's data URL (and any absolute URL) passes through. -->
    <div class="chat chat-start">
      <div class="chat-bubble chat-bubble-primary">
        {#if rendered.chunk.type === "text"}
          <p>{rendered.chunk.text}</p>
        {:else if rendered.chunk.type === "image"}
          {#if failedImages.includes(rendered.chunk.url)}
            <span class="text-sm opacity-70">image expired</span>
          {:else}
            <img
              src={resolveImageUrl(rendered.chunk.url, apiBaseUrl)}
              alt={rendered.chunk.mimeType ?? "pasted image"}
              loading="lazy"
              decoding="async"
              onerror={() => {
                if (rendered.chunk.type === "image" && rendered.chunk.url.startsWith("/images/")) {
                  failedImages = [...failedImages, rendered.chunk.url];
                }
              }}
              class="max-h-80 max-w-full rounded"
            />
          {/if}
        {/if}
      </div>
    </div>
  {:else if rendered.chunk.type === "thinking"}
    <!-- Thinking: a visible bubble (like tool cards), holding a checkbox collapse
         (no arrow icon, smooth open/close). Title reads "Thinking" + loading dots
         while generating, then "Thoughts" with no dots once complete. -->
    <div class="chat chat-start [&>.chat-bubble]:max-w-5xl [&>.chat-bubble]:p-0">
      <div class="chat-bubble w-full bg-transparent">
        <LazyCollapse label="Toggle thoughts">
          {#snippet title()}
            <span>{rendered.streaming ? "Thinking" : "Thoughts"}</span>
            {#if rendered.streaming}
              <span class="loading loading-dots loading-sm" aria-label="Generating"></span>
            {/if}
          {/snippet}
          <p class="whitespace-pre-wrap">{rendered.chunk.type === "thinking" ? rendered.chunk.text : ""}</p>
        </LazyCollapse>
      </div>
    </div>
  {:else}
    <!-- Assistant text / system / error: an INVISIBLE speech bubble — same
         chat-start grid as the user bubble, so it inherits identical left spacing. -->
    <div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
      <div class="chat-bubble w-full bg-transparent">
        {#if rendered.chunk.type === "text"}
          <Markdown
            text={rendered.chunk.text}
            streaming={rendered.streaming ?? false}
            image={{ apiBase: apiBaseUrl, cwd }}
          />
        {:else if rendered.chunk.type === "error"}
          <div class="text-error" role="alert">
            {rendered.chunk.message}
            {#if rendered.chunk.code}
              <span class="text-xs opacity-70">[{rendered.chunk.code}]</span>
            {/if}
          </div>
        {:else if rendered.chunk.type === "system"}
          <div class="text-sm opacity-70">{rendered.chunk.text}</div>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<div class="flex flex-col gap-2 pt-4 pb-4 pl-6" role="log" aria-live="polite">
  {#if hasEarlier && onShowEarlier}
    <!-- Chat limit: older chunks are unloaded; offer to page them back in. -->
    <div class="flex justify-center">
      <button class="btn btn-ghost btn-xs" disabled={loadingEarlier} onclick={showEarlier}>
        {#if loadingEarlier}
          <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          Loading earlier messages…
        {:else}
          Show earlier messages
        {/if}
      </button>
    </div>
  {/if}
  {#each keyedRows as { row, key }, i (key)}
    <!-- `.chat-row`: content-visibility:auto — the browser skips layout/paint
         for rows outside the viewport (see app.css). -->
    <div class="chat-row">
    {#if row.kind === "step-metrics"}
      {@const sv = viewStepMetrics(row.step, row.index)}
      {@const stepCache = viewCacheRate(row.step.usage)}
      {@const stepStamp = cacheTimer?.stepStamps.get(row.step.stepId)}
      <div class="chat chat-start">
        <div class="chat-bubble w-full max-w-5xl bg-transparent p-0">
          <div class="flex flex-wrap items-center gap-x-1 text-xs">
            <span class="opacity-70">
              {sv.label} · {sv.tokensLabel}
              {#if sv.tps}
                · {sv.tps}{/if}
              {#if sv.ttft}
                · {sv.ttft} to first token{/if}
              ·
            </span>
            <span class="opacity-70">cache:</span>
            <span
              class="badge badge-xs {badgeClass[stepCache.level]}"
              data-testid="step-cache-badge">{stepCache.pct}%</span
            >
            {#if stepStamp !== undefined}
              <CacheTimerBadge elapsedMs={stepStamp} size="xs" />
            {/if}
          </div>
        </div>
      </div>
    {:else if row.kind === "turn-metrics"}
      {@const turnView = viewTurnMetrics(row.turn, row.turnNumber)}
      {@const lastCache = viewCacheRate(row.turn.usage)}
      {@const chatCache = viewCacheRate(row.cumulativeUsage)}
      {@const retention = viewExpectedCache(row.turn.steps[0]?.usage, row.prevLastStepUsage)}
      {@const turnLive = liveTurnSince(row.turn.turnId, i)}
      {@const turnStamp = cacheTimer?.turnStamps.get(row.turn.turnId)}
      <div class="chat chat-start">
        <div class="chat-bubble w-full max-w-5xl bg-transparent p-0">
          <div class="flex flex-col gap-1 text-xs">
            <div class="opacity-70">
              {turnView.label} · {turnView.tokensLabel} · {turnView.breakdown}
              {#if turnView.tps}
                · {turnView.tps}{/if}
              {#if turnView.duration}
                · {turnView.duration}{/if}
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="flex items-center gap-1">
                <span class="opacity-70">Last turn:</span>
                <span class="badge badge-sm {badgeClass[lastCache.level]}">{lastCache.pct}%</span>
              </span>
              <span class="flex items-center gap-1">
                <span class="opacity-70">Chat Total:</span>
                <span class="badge badge-sm {badgeClass[chatCache.level]}">{chatCache.pct}%</span>
              </span>
              {#if retention}
                <span class="flex items-center gap-1">
                  <span class="opacity-70">Retention:</span>
                  <span class="badge badge-sm {badgeClass[retention.level]}">{retention.pct}%</span>
                </span>
              {/if}
              {#if turnLive !== undefined}
                <CacheTimerBadge since={turnLive} />
              {:else if turnStamp !== undefined}
                <CacheTimerBadge elapsedMs={turnStamp} />
              {/if}
            </div>
          </div>
        </div>
      </div>
    {:else if row.group.kind === "single"}
      {@render chunkRow(row.group.chunk)}
    {:else}
      <!-- Each call owns one bubble; the matching result is folded into its card. -->
      <div class="chat chat-start [grid-template-columns:auto_minmax(0,1fr)] [&>.chat-bubble]:max-w-5xl [&>.chat-bubble]:p-0">
        <div class="chat-bubble min-w-0 w-full bg-transparent">
          <ToolCard entry={row.group.entry} />
        </div>
      </div>
    {/if}
    </div>
  {/each}
  {#if liveStepGap}
    <!-- Live cache timer while the last step's tools execute; stamped onto that
         step's metrics line once they return (or the next step starts). -->
    <div class="chat chat-start">
      <div class="chat-bubble w-full max-w-5xl bg-transparent p-0">
        <div class="flex items-center gap-1 text-xs" data-testid="cache-timer-tools">
          <span class="opacity-70">Running tools</span>
          <CacheTimerBadge since={liveStepGap.startedAt} size="xs" />
        </div>
      </div>
    </div>
  {/if}
  {#if providerRetry}
    {@const rv = viewProviderRetry(providerRetry)}
    <!-- Transient yellow warning: a provider error is being retried with backoff.
         NOT a message chunk (never persisted/replayed) — a live UI notification only,
         shown where the reply would appear. Coalesces to the newest attempt + delay,
         and is cleared (foldEvent) when content resumes or the turn ends. -->
    <div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
      <div class="chat-bubble w-full bg-transparent">
        <div class="alert alert-warning flex-wrap items-start gap-2 py-2 text-sm" role="status">
          <div class="flex flex-wrap items-center gap-2 font-medium">
            <span aria-hidden="true">⚠</span>
            <span>{rv.attemptLabel} — retrying in {rv.delayLabel}…</span>
            {#if rv.code}
              <span class="badge badge-warning badge-sm font-mono">{rv.code}</span>
            {/if}
          </div>
          <div class="w-full font-mono text-xs opacity-70">{rv.message}</div>
        </div>
      </div>
    </div>
  {/if}
</div>
