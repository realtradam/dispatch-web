<script lang="ts">
  import { computeContextUsage, formatCompactTokens } from "../../../core/metrics";

  const FALLBACK_CONTEXT_WINDOW = 1_000_000;
  const MAX_LINES = 7;

  let {
    onSend,
    onQueue,
    onStop,
    contextSize = undefined,
    contextWindow = undefined,
    status = "idle",
  }: {
    onSend: (text: string) => void;
    /**
     * Enqueue a steering message (`chat.queue`). When provided AND the status
     * is `running`, the send button becomes a "Queue" button that steers the
     * in-flight turn instead of starting a new one. When absent, `onSend` is
     * used regardless (tests / non-steering contexts).
     */
    onQueue?: (text: string) => void;
    /** Stop the in-flight generation (`POST /conversations/:id/stop`). */
    onStop?: () => void;
    // Current context occupancy (latest turn's contextSize), or `undefined`
    // when unknown — the status bar then shows "— tokens", never 0%.
    contextSize?: number | undefined;
    /** Per-model context window (max tokens) from `GET /models` modelInfo. */
    contextWindow?: number | undefined;
    /**
     * Coarse agent status for the status-bar icon. `queued` = the turn is in
     * flight but waiting for a concurrency slot (CR-13) — shown as a loading
     * RING (vs the loading DOTS of `running`/actively generating). Behaves like
     * `running` for the send button (steer/stop).
     */
    status?: ComposerStatus;
  } = $props();

  export type ComposerStatus = "idle" | "running" | "queued" | "error";

  let text = $state("");
  let inputEl: HTMLTextAreaElement | undefined;

  const hasText = $derived(text.trim().length > 0);
  const effectiveMax = $derived(contextWindow ?? FALLBACK_CONTEXT_WINDOW);
  const usage = $derived(computeContextUsage(contextSize, effectiveMax));
  const hasUsage = $derived(contextSize !== undefined);

  // One button, three modes:
  // - idle → "Send" (starts a turn via chat.send)
  // - running/queued + text → "Queue" (steers via chat.queue)
  // - running/queued + empty → "Stop" (aborts via POST /stop)
  // (`queued` behaves like `running` — the turn is in flight, just waiting for a
  // concurrency slot; the user can still steer or stop it.)
  const inFlight = $derived(status === "running" || status === "queued");
  const buttonMode = $derived.by<"send" | "queue" | "stop">(() => {
    if (inFlight && !hasText && onStop !== undefined) return "stop";
    if (inFlight && hasText && onQueue !== undefined) return "queue";
    return "send";
  });
  const placeholder = $derived(
    status === "queued"
      ? "Queued for a slot…"
      : status === "running"
        ? "Steer the conversation..."
        : "Type a message...",
  );

  // As the window fills, escalate color: calm → warning → danger.
  function fillClass(pct: number): string {
    if (pct >= 90) return "progress-error";
    if (pct >= 70) return "progress-warning";
    return "progress-success";
  }

  function resize(): void {
    const el = inputEl;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const borderY =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const maxHeight = lineHeight * MAX_LINES + paddingY + borderY;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  // Re-run resize whenever the value changes (covers programmatic clears too).
  $effect(() => {
    void text;
    resize();
  });

  function handleSubmit(): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (buttonMode === "queue") {
      onQueue?.(trimmed);
    } else {
      onSend(trimmed);
    }
    text = "";
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<form
  class="flex flex-col"
  onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}
>
  <!-- Top bar: expanding textarea + single context-aware button -->
  <div class="flex items-end gap-2 px-4 pt-3 pb-2">
    <textarea
      bind:this={inputEl}
      class="textarea textarea-bordered flex-1 resize-none leading-normal !min-h-0 h-auto"
      bind:value={text}
      onkeydown={handleKeydown}
      {placeholder}
      rows="1"
      aria-label="Message input"></textarea>
    {#if buttonMode === "stop"}
      <button
        class="btn btn-error w-20 shrink-0"
        type="button"
        aria-label="Stop generation"
        onclick={() => onStop?.()}
      >
        Stop
      </button>
    {:else}
      <button class="btn btn-primary w-20 shrink-0" type="submit" disabled={!hasText}>
        {buttonMode === "queue" ? "Queue" : "Send"}
      </button>
    {/if}
  </div>

  <!-- Bottom status bar: status icon · context-window fill · token count -->
  <div class="flex items-center gap-2 px-4 pb-2 text-xs text-base-content/50">
    <span class="shrink-0">
      {#if status === "queued"}
        <!-- Waiting for a concurrency slot — a ring (vs the dots of `running`). -->
        <span
          class="loading loading-spinner loading-xs text-primary"
          aria-label="Queued"
          title="Waiting for a concurrency slot"
        ></span>
      {:else if status === "running"}
        <span class="loading loading-dots loading-xs text-primary"></span>
      {:else if status === "error"}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4 text-error"
          aria-label="Error"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      {:else}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4 text-success"
          aria-label="Idle"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      {/if}
    </span>

    {#if usage.percent !== null}
      <progress
        class="progress h-2 flex-1 {fillClass(usage.percent)}"
        value={usage.percent}
        max="100"
      ></progress>
    {:else}
      <progress class="progress h-2 flex-1 opacity-40" value="0" max="100"></progress>
    {/if}

    <span class="shrink-0 whitespace-nowrap font-mono">
      {#if hasUsage}
        {formatCompactTokens(usage.current)}{#if usage.max !== null}<span
            class="text-base-content/40"
          >
            / {formatCompactTokens(usage.max)}</span
          >{/if}
        {#if usage.percent !== null}
          <span class="ml-1">· {usage.percent.toFixed(1)}%</span>
        {/if}
      {:else}
        <span class="text-base-content/40">— tokens</span>
      {/if}
    </span>
  </div>
</form>
