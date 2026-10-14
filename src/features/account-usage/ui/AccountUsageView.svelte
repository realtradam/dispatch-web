<script lang="ts">
  import { untrack } from "svelte";
  import type {
    AccountUsageReport,
    AccountUsageResponse,
    LoadAccountUsage,
    SaveAccountUsageSettings,
  } from "../logic/types";
  import { viewProviderCards } from "../logic/view-model";
  import DailyCreditsSettings from "./DailyCreditsSettings.svelte";
  import UsageBar from "./UsageBar.svelte";

  let {
    load,
    saveSettings,
    now = () => Date.now(),
    pollMs = 60_000,
  }: {
    load: LoadAccountUsage;
    /** Save per-provider settings (Hyper allowance + reset time). */
    saveSettings: SaveAccountUsageSettings;
    /** Injected clock (tests). */
    now?: () => number;
    /** How often to re-read `GET /usage` (served from the backend cache). */
    pollMs?: number;
  } = $props();

  let usage = $state<AccountUsageResponse | null>(null);
  let error = $state<string | null>(null);
  let refreshing = $state(false);
  let inFlight = false;
  /** Ticks so the pace marker + "resets in" labels advance between polls. */
  let clock = $state(untrack(() => now()));

  const cards = $derived(usage ? viewProviderCards(usage, clock) : []);

  async function refresh(force: boolean): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    if (force) refreshing = true;
    const result = await load(force ? { refresh: true } : undefined);
    inFlight = false;
    refreshing = false;
    clock = now();
    if (result.ok) {
      usage = result.usage;
      error = null;
    } else {
      error = result.unavailable
        ? "Account usage is unavailable (backend extension not loaded)."
        : result.error;
    }
  }

  /** Splice a provider's refreshed report (from a settings save) into the view. */
  function replaceReport(report: AccountUsageReport): void {
    clock = now();
    if (!usage) return;
    usage = {
      ...usage,
      providers: usage.providers.map((p) => (p.provider === report.provider ? report : p)),
    };
  }

  $effect(() => {
    const interval = untrack(() => pollMs);
    untrack(() => void refresh(false));
    const poll = setInterval(() => void refresh(false), interval);
    const tick = setInterval(() => {
      clock = now();
    }, 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  });
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-xs font-semibold uppercase opacity-60">Subscription usage</h3>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      onclick={() => void refresh(true)}
      disabled={refreshing}
      aria-label="Refresh account usage"
    >
      {#if refreshing}<span class="loading loading-spinner loading-xs"></span>{/if}
      Refresh
    </button>
  </div>

  {#if error}
    <p class="text-xs text-error">{error}</p>
  {/if}

  {#if usage === null && error === null}
    <p class="text-xs opacity-60">Loading…</p>
  {/if}

  {#each cards as card (card.provider)}
    <section class="flex flex-col gap-2 rounded-box bg-base-200 p-2" aria-label="{card.label} usage">
      <div class="flex items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col">
          <span class="text-sm font-semibold">{card.label}</span>
          {#if card.subtitle}
            <span class="truncate text-[11px] opacity-60">{card.subtitle}</span>
          {/if}
        </div>
        <div class="flex shrink-0 flex-col items-end gap-0.5">
          {#if card.stateBadge}
            <span
              class="badge badge-xs"
              class:badge-warning={card.state === "stale"}
              class:badge-error={card.state === "unavailable"}
              class:badge-ghost={card.state === "unsupported" || card.state === "not-configured"}
              >{card.stateBadge}</span
            >
          {/if}
          {#if card.ageLabel}
            <span class="text-[11px] opacity-50">updated {card.ageLabel}</span>
          {/if}
        </div>
      </div>

      {#if card.message}
        <p class="text-xs opacity-70">{card.message}</p>
      {/if}
      {#if card.creditNote}
        <p class="text-xs text-warning">{card.creditNote}</p>
      {/if}

      {#each card.bars as bar (bar.id)}
        <UsageBar {bar} />
      {/each}

      {#if card.daily}
        <DailyCreditsSettings
          daily={card.daily}
          save={saveSettings}
          onSaved={replaceReport}
          {now}
        />
      {/if}
    </section>
  {/each}

  {#if cards.some((c) => c.bars.some((b) => b.pacePercent !== null))}
    <p class="flex items-center gap-1.5 text-[11px] opacity-50">
      <span class="inline-block size-2 rounded-full bg-base-content"></span>
      on-track pace — usage that would exactly use the allowance by its reset
    </p>
  {/if}
</div>
