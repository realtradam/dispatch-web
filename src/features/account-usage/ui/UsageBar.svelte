<script lang="ts">
  import type { UsageBarView } from "../logic/view-model";

  let { bar }: { bar: UsageBarView } = $props();

  const progressClass = $derived(
    {
      success: "progress-success",
      warning: "progress-warning",
      error: "progress-error",
      neutral: "",
    }[bar.tone],
  );
</script>

<div class="flex flex-col gap-0.5" data-testid="usage-bar" data-limit-id={bar.id}>
  <div class="flex items-baseline justify-between gap-2 text-xs">
    <span class="truncate font-medium">{bar.label}</span>
    <span class="shrink-0 font-mono tabular-nums">{bar.valueLabel}</span>
  </div>
  <div class="relative flex items-center">
    <progress
      class="progress h-2 w-full {progressClass}"
      value={bar.percent}
      max="100"
      aria-label="{bar.label} usage"
    ></progress>
    {#if bar.pacePercent !== null}
      <!-- Pace marker: where usage would be if spread evenly to the reset. -->
      <span
        class="pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base-100 bg-base-content"
        style="left: {bar.pacePercent}%"
        data-testid="pace-marker"
        title="On-track pace: {Math.round(bar.pacePercent)}%"
        aria-hidden="true"
      ></span>
    {/if}
  </div>
  {#if bar.resetLabel || bar.paceLabel}
    <div class="flex justify-between gap-2 text-[11px] opacity-60">
      <span>{bar.resetLabel ?? ""}</span>
      {#if bar.paceLabel}
        <span class:text-warning={bar.aheadOfPace} class:opacity-100={bar.aheadOfPace}
          >{bar.paceLabel}</span
        >
      {/if}
    </div>
  {/if}
</div>
