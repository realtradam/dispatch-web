<script lang="ts">
  import type { TurnProviderRetryEvent } from "@dispatch/wire";
  import { groupRenderedChunks, resolveImageUrl, type RenderedChunk, viewProviderRetry } from "../index";
  import {
    interleaveTurnMetrics,
    viewCacheRate,
    viewExpectedCache,
    viewStepMetrics,
    viewTurnMetrics,
    type TurnMetricsEntry,
  } from "../../../core/metrics";
  import { Markdown } from "../../markdown";

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
  } = $props();

  // True while a show-earlier page-in is awaited (disables the button).
  let loadingEarlier = $state(false);

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
      if (group.kind === "tool-batch") {
        key = `b${group.stepId}`;
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
          <img
            src={resolveImageUrl(rendered.chunk.url, apiBaseUrl)}
            alt={rendered.chunk.mimeType ?? "pasted image"}
            loading="lazy"
            decoding="async"
            class="max-h-80 max-w-full rounded"
          />
        {/if}
      </div>
    </div>
  {:else if rendered.chunk.type === "thinking"}
    <!-- Thinking: a visible bubble (like tool cards), holding a checkbox collapse
         (no arrow icon, smooth open/close). Title reads "Thinking" + loading dots
         while generating, then "Thoughts" with no dots once complete. -->
    <div class="chat chat-start [&>.chat-bubble]:max-w-5xl [&>.chat-bubble]:p-0">
      <div class="chat-bubble w-full bg-transparent">
        <div class="collapse w-full rounded-box bg-base-200 text-sm">
          <input type="checkbox" aria-label="Toggle thoughts" />
          <div class="collapse-title flex min-h-0 items-center gap-2 py-2 font-medium">
            <span>{rendered.streaming ? "Thinking" : "Thoughts"}</span>
            {#if rendered.streaming}
              <span class="loading loading-dots loading-sm" aria-label="Generating"></span>
            {/if}
          </div>
          <div class="collapse-content">
            <p class="whitespace-pre-wrap">{rendered.chunk.text}</p>
          </div>
        </div>
      </div>
    </div>
  {:else if rendered.chunk.type === "tool-call" || rendered.chunk.type === "tool-result"}
    <!-- Single tool call/result: a collapsible card (collapsed by default,
         like thinking). Title shows the tool name; content shows the
         input/output. Same chat-start grid shim as the thinking block. -->
    <div class="chat chat-start [&>.chat-bubble]:max-w-5xl [&>.chat-bubble]:p-0">
      <div class="chat-bubble w-full bg-transparent">
        {#if rendered.chunk.type === "tool-call"}
          <div class="collapse w-full rounded-box bg-base-200 text-sm">
            <input type="checkbox" aria-label="Toggle tool call" />
            <div class="collapse-title flex min-h-0 items-center gap-2 py-2 font-medium">
              <svg
                class="h-4 w-4 opacity-60"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                /></svg
              >
              <span>{rendered.chunk.toolName}</span>
            </div>
            <div class="collapse-content">
              <pre class="overflow-x-auto text-xs">{JSON.stringify(
                  rendered.chunk.input,
                  null,
                  2,
                )}</pre>
            </div>
          </div>
        {:else}
          <div class="collapse w-full rounded-box bg-base-200 text-sm">
            <input type="checkbox" aria-label="Toggle tool result" />
            <div
              class="collapse-title flex min-h-0 items-center gap-2 py-2 font-medium"
              class:text-error={rendered.chunk.isError}
            >
              <svg
                class="h-4 w-4 opacity-60"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                /></svg
              >
              <span>{rendered.chunk.toolName}</span>
              {#if rendered.chunk.isError}
                <span class="badge badge-error badge-xs">error</span>
              {/if}
            </div>
            <div class="collapse-content">
              <pre class="max-h-96 overflow-auto text-xs">{rendered.chunk.content}</pre>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Assistant text / system / error: an INVISIBLE speech bubble — same
         chat-start grid as the user bubble, so it inherits identical left spacing. -->
    <div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
      <div class="chat-bubble w-full bg-transparent">
        {#if rendered.chunk.type === "text"}
          <Markdown text={rendered.chunk.text} streaming={rendered.streaming ?? false} />
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

<div class="flex flex-col gap-2 p-4 pl-6" role="log" aria-live="polite">
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
  {#each keyedRows as { row, key } (key)}
    {#if row.kind === "step-metrics"}
      {@const sv = viewStepMetrics(row.step, row.index)}
      <div class="chat chat-start">
        <div class="chat-bubble w-full max-w-5xl bg-transparent p-0">
          <div class="text-xs opacity-70">
            {sv.label} · {sv.tokensLabel}
            {#if sv.tps}
              · {sv.tps}{/if}
            {#if sv.genTotal}
              · {sv.genTotal}{/if}
          </div>
        </div>
      </div>
    {:else if row.kind === "turn-metrics"}
      {@const turnView = viewTurnMetrics(row.turn, row.turnNumber)}
      {@const lastCache = viewCacheRate(row.turn.usage)}
      {@const chatCache = viewCacheRate(row.cumulativeUsage)}
      {@const retention = viewExpectedCache(row.turn.usage, row.prevTurnUsage)}
      <div class="chat chat-start">
        <div class="chat-bubble w-full max-w-5xl bg-transparent p-0">
          <div class="flex flex-col gap-1 text-xs">
            <div class="opacity-70">
              {turnView.label} · {turnView.tokensLabel} ({turnView.breakdown})
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
            </div>
          </div>
        </div>
      </div>
    {:else if row.group.kind === "single"}
      {@render chunkRow(row.group.chunk)}
    {:else}
      <!-- Batched tool calls (one step): each entry is a collapsible card.
           Click to expand and see the input/output. -->
      <div class="chat chat-start [&>.chat-bubble]:max-w-5xl [&>.chat-bubble]:p-0">
        <div class="chat-bubble w-full bg-transparent">
          <div class="flex flex-col gap-1">
            {#each row.group.entries as entry (entry.call.toolCallId)}
              <div class="collapse w-full rounded-box bg-base-200 text-sm">
                <input type="checkbox" aria-label="Toggle tool call" />
                <div class="collapse-title flex min-h-0 items-center gap-2 py-2 font-medium">
                  <svg
                    class="h-4 w-4 opacity-60"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path
                      d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                    /></svg
                  >
                  <span>{entry.call.toolName}</span>
                  {#if entry.result?.isError}
                    <span class="badge badge-error badge-xs">error</span>
                  {:else if entry.result === null}
                    <span class="loading loading-spinner loading-xs" aria-label="Running"></span>
                  {/if}
                </div>
                <div class="collapse-content">
                  <pre class="overflow-x-auto text-xs">{JSON.stringify(
                      entry.call.input,
                      null,
                      2,
                    )}</pre>
                  {#if entry.result}
                    <pre
                      class="mt-1 max-h-96 overflow-auto text-xs"
                      class:text-error={entry.result.isError}>{entry.result.content}</pre>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  {/each}
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
