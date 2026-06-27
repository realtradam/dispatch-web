<script lang="ts">
  import { untrack } from "svelte";
  import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
  import {
    type Badge,
    parseLimitInput,
    providerOptions,
    summarizeLimits,
    summarizeStatus,
    viewConcurrencyLimits,
    viewConcurrencyStatuses,
  } from "../logic/view-model";
  import type {
    ConcurrencyLimitEntry,
    DeleteConcurrencyLimit,
    LoadConcurrencyLimits,
    LoadConcurrencyStatus,
    SaveConcurrencyLimit,
  } from "../logic/types";
  import ConcurrencyLimitRow from "./ConcurrencyLimitRow.svelte";

  let {
    models,
    loadLimits,
    saveLimit,
    deleteLimit,
    loadStatus,
  }: {
    /** Available models (`<provider>/<model>`) — the source of provider ids for the Add dropdown. */
    models: readonly string[];
    loadLimits: LoadConcurrencyLimits;
    saveLimit: SaveConcurrencyLimit;
    deleteLimit: DeleteConcurrencyLimit;
    loadStatus: LoadConcurrencyStatus;
  } = $props();

  const badgeClass: Record<Badge, string> = {
    success: "badge-success",
    warning: "badge-warning",
    error: "badge-error",
    neutral: "badge-ghost",
  };

  // ── Limits (config: list / add / update / remove) ────────────────────────────
  let limits = $state<readonly ConcurrencyLimitEntry[]>([]);
  let limitsError = $state<string | null>(null);
  /** True after the first load settles (gates the empty state). */
  let hasLoadedLimits = $state(false);
  /** Re-entrancy guard for background/silent refreshes (no UI — prevents
   *  overlapping fetches). The refresh is near-instant, so a visible loading
   *  indicator would flicker every poll/reload; it stays INVISIBLE (mirrors the
   *  heartbeat runs list). */
  let limitsInFlight = false;

  // Add-form state. The provider id is chosen from a dropdown of known providers
  // (derived from the available models + any already-configured limit providers).
  let newProviderId = $state("");
  let newLimitInput = $state("");
  let adding = $state(false);
  let addError = $state<string | null>(null);

  const providerOpts = $derived(providerOptions(models, limits));
  const limitViews = $derived(viewConcurrencyLimits(limits));
  const limitsSummary = $derived(summarizeLimits(limits));
  const parsedNewLimit = $derived(parseLimitInput(newLimitInput));
  const canAdd = $derived(
    newProviderId !== "" &&
      parsedNewLimit !== null &&
      !limits.some((l) => l.providerId === newProviderId) &&
      !adding,
  );

  // Keep the dropdown selection valid: default to the first option, and if the
  // selected provider is removed from the options (e.g. its limit was deleted and
  // it has no models), fall back to the first remaining option. Runs untracked so
  // it doesn't loop on its own assignment.
  $effect(() => {
    const opts = providerOpts;
    untrack(() => {
      if (opts.length === 0) {
        if (newProviderId !== "") newProviderId = "";
        return;
      }
      if (!opts.includes(newProviderId)) newProviderId = opts[0] ?? "";
    });
  });

  async function refreshLimits(): Promise<void> {
    if (limitsInFlight) return;
    limitsInFlight = true;
    const result = await loadLimits();
    limitsInFlight = false;
    hasLoadedLimits = true;
    if (result.ok) {
      limits = result.limits;
      // Clear the error only on success so it stays visible (stable, no flicker)
      // during an in-flight retry rather than vanishing mid-refresh.
      limitsError = null;
    } else {
      limitsError = result.error;
    }
  }

  async function handleAdd(): Promise<void> {
    if (parsedNewLimit === null || newProviderId === "") return;
    adding = true;
    addError = null;
    const result = await saveLimit(newProviderId, parsedNewLimit);
    adding = false;
    if (result.ok) {
      newLimitInput = "";
      void refreshLimits();
      void refreshStatus();
    } else {
      addError = result.error;
    }
  }

  // Wrap the ports so a row's save/remove reloads the authoritative list + status
  // on success (the row still gets the result to drive its own UI).
  async function rowSave(providerId: string, limit: number) {
    const result = await saveLimit(providerId, limit);
    if (result.ok) {
      void refreshLimits();
      void refreshStatus();
    }
    return result;
  }

  async function rowRemove(providerId: string) {
    const result = await deleteLimit(providerId);
    if (result.ok) {
      void refreshLimits();
      void refreshStatus();
    }
    return result;
  }

  // ── Live status (polls while mounted) ───────────────────────────────────────
  let statusEntries = $state<readonly ConcurrencyStatusEntry[]>([]);
  let statusError = $state<string | null>(null);
  /** True after the first load settles (gates the empty state). */
  let hasLoadedStatus = $state(false);
  /** Re-entrancy guard for the 2s background poll (no UI — a visible loading
   *  indicator flickered every poll because the refresh is near-instant; it stays
   *  INVISIBLE, mirroring the heartbeat runs list). */
  let statusInFlight = false;
  let now = $state(Date.now());

  // A 1s clock so a `paused — resumes in Ns` countdown ticks live between polls.
  $effect(() => {
    const h = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(h);
  });

  const statusViews = $derived(viewConcurrencyStatuses(statusEntries, now));
  const statusSummary = $derived(summarizeStatus(statusEntries, now));

  async function refreshStatus(): Promise<void> {
    if (statusInFlight) return;
    statusInFlight = true;
    const result = await loadStatus();
    statusInFlight = false;
    hasLoadedStatus = true;
    if (result.ok) {
      statusEntries = result.providers;
      // Clear the error only on success so it stays visible (stable, no flicker)
      // during an in-flight retry rather than vanishing mid-poll.
      statusError = null;
    } else {
      statusError = result.error;
    }
  }

  const STATUS_POLL_MS = 2000;

  // Load limits + status on mount, and poll the live status while the view is
  // alive (a running provider's in-flight/queued/paused transitions stay fresh
  // without a manual refresh). Runs once — no reactive deps read inside.
  $effect(() => {
    untrack(() => {
      void refreshLimits();
      void refreshStatus();
    });
    const h = setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_MS);
    return () => clearInterval(h);
  });
</script>

<div class="flex flex-col gap-4">
  <!-- Limits (config) -->
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase opacity-60">Concurrency limits</h3>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={() => refreshLimits()}
        aria-label="Refresh concurrency limits"
      >
        Refresh
      </button>
    </div>

    <!-- Add form -->
    <form
      class="flex flex-wrap items-end gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void handleAdd();
      }}
    >
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase opacity-60">Provider</span>
        <select
          class="select select-bordered select-xs w-40 font-mono"
          aria-label="Provider"
          bind:value={newProviderId}
          disabled={adding || providerOpts.length === 0}
        >
          {#if providerOpts.length === 0}
            <option value="" disabled>No providers available</option>
          {:else}
            {#each providerOpts as provider (provider)}
              <option value={provider}>{provider}</option>
            {/each}
          {/if}
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase opacity-60">Limit</span>
        <input
          type="text"
          inputmode="numeric"
          class="input input-bordered input-xs w-20 font-mono"
          placeholder="4"
          bind:value={newLimitInput}
          disabled={adding}
        />
      </label>
      <button
        type="submit"
        class="btn btn-primary btn-xs"
        disabled={!canAdd}
      >
        {#if adding}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          Add
        {/if}
      </button>
    </form>
    {#if addError}
      <p class="font-mono text-xs text-error">{addError}</p>
    {/if}

    <span class="text-xs opacity-70">{limitsSummary}</span>

    {#if limitsError}
      <p class="text-xs text-error">{limitsError}</p>
    {:else if hasLoadedLimits && limitViews.length === 0}
      <p class="text-xs opacity-60">No limits configured — providers run unlimited.</p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each limitViews as limit (limit.providerId)}
          <li>
            <ConcurrencyLimitRow {limit} save={rowSave} remove={rowRemove} />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Live status -->
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase opacity-60">Live status</h3>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={() => refreshStatus()}
        aria-label="Refresh concurrency status"
      >
        Refresh
      </button>
    </div>

    <span class="text-xs opacity-70">{statusSummary}</span>

    {#if statusError}
      <p class="text-xs text-error">{statusError}</p>
    {:else if hasLoadedStatus && statusViews.length === 0}
      <p class="text-xs opacity-60">No limits configured — nothing to report.</p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each statusViews as s (s.providerId)}
          <li class="flex flex-col gap-1 rounded-box bg-base-200 p-2 text-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium font-mono" title={s.providerId}>{s.providerId}</span>
              <span class="badge badge-sm {badgeClass[s.badge]} gap-1">
                {#if s.busy}
                  <span class="loading loading-spinner loading-xs"></span>
                {/if}
                {#if s.paused}
                  Paused
                {:else if s.inFlight >= s.limit && s.queued > 0}
                  At capacity
                {:else if s.inFlight > 0}
                  Active
                {:else}
                  Idle
                {/if}
              </span>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs opacity-70">
              <span title="In-flight slots held vs cap">{s.inFlightLabel} in flight</span>
              <span>{s.queuedLabel}</span>
            </div>
            {#if s.pausedLabel}
              <span class="text-xs text-warning">{s.pausedLabel}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
