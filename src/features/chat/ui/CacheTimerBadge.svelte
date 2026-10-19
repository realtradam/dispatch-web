<script lang="ts">
  /**
   * One cache-timer badge. LIVE when given `since` (counts up from that epoch
   * ms, ticking once a second, and stops ticking at the 10-minute cap); STAMPED
   * when given `elapsedMs` (a finished gap — static). Formatting lives in
   * `core/metrics` (`viewCacheTimer`). Owning the tick here means only this
   * badge re-renders each second, not the transcript.
   */
  import { untrack } from "svelte";
  import { CACHE_TIMER_MAX_MS, viewCacheTimer } from "../../../core/metrics";

  let {
    since,
    elapsedMs,
    now = Date.now,
  }: {
    /** Live: epoch ms the gap started. */
    since?: number;
    /** Stamped: the gap's final duration (wins over `since`). */
    elapsedMs?: number;
    /** Wall clock (injected for tests). */
    now?: () => number;
  } = $props();

  // Initial read only (the effect below keeps it current while live).
  let current = $state(untrack(() => now()));

  $effect(() => {
    if (elapsedMs !== undefined || since === undefined) return;
    const start = since;
    current = now();
    if (current - start >= CACHE_TIMER_MAX_MS) return;
    const id = setInterval(() => {
      current = now();
      if (current - start >= CACHE_TIMER_MAX_MS) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  });

  const badgeClass = {
    success: "badge-success",
    warning: "badge-warning",
    error: "badge-error",
  } as const;

  const live = $derived(elapsedMs === undefined);
  const view = $derived(viewCacheTimer(elapsedMs ?? current - (since ?? current)));
</script>

<span
  class="badge badge-sm gap-1 font-mono tabular-nums {badgeClass[view.level]}"
  class:badge-outline={!live}
  title={live
    ? "Cache timer (running): time since the last model request. The Claude prompt cache expires after 5 minutes idle."
    : "Cache timer (stopped): how long the cache sat idle before the next request. The Claude prompt cache expires after 5 minutes idle."}
  data-testid={live ? "cache-timer-live" : "cache-timer-stamp"}
  ><span aria-hidden="true">⏱</span>{view.label}</span
>
