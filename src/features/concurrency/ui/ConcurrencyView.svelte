<script lang="ts">
  import { untrack } from "svelte";
  import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
  import {
    type Badge,
    type ConcurrencyLimitView,
    parseLimitInput,
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
    loadLimits,
    saveLimit,
    deleteLimit,
    loadStatus,
  }: {
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
  let limitsLoading = $state(false);
  let limitsError = $state<string | null>(null);
  let hasLoadedLimits = $state(false);

  // Add-form state.
  let newProviderId = $state("");
  let newLimitInput = $state("");
  let adding = $state(false);
  let addError = $state<string | null>(null);

  const limitViews = $derived(viewConcurrencyLimits(limits));
  const limitsSummary = $derived(summarizeLimits(limits));
  const parsedNewLimit = $derived(parseLimitInput(newLimitInput));
  const trimmedProviderId = $derived(newProviderId.trim());
  const canAdd = $derived(
    trimmedProviderId !== "" &&
      parsedNewLimit !== null &&
      !limits.some((l) => l.providerId === trimmedProviderId) &&
      !adding,
  );

  async function refreshLimits(): Promise<void> {
    limitsLoading = true;
    limitsError = null;
    const result = await loadLimits();
    limitsLoading = false;
    hasLoadedLimits = true;
    if (result.ok) {
      limits = result.limits;
    } else {
      limitsError = result.error;
    }
  }

  async function handleAdd(): Promise<void> {
    if (parsedNewLimit === null || trimmedProviderId === "") return;
    adding = true;
    addError = null;
    const result = await saveLimit(trimmedProviderId, parsedNewLimit);
    adding = false;
    if (result.ok) {
      newProviderId = "";
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
  let statusLoading = $state(false);
  let statusError = $state<string | null>(null);
  let hasLoadedStatus = $state(false);
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
    statusLoading = true;
    statusError = null;
    const result = await loadStatus();
    statusLoading = false;
    hasLoadedStatus = true;
    if (result.ok) {
      statusEntries = result.providers;
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
        disabled={limitsLoading}
        onclick={() => refreshLimits()}
        aria-label="Refresh concurrency limits"
      >
        {#if limitsLoading}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          Refresh
        {/if}
      </button>
    </div>
    <p class="text-xs opacity-60">
      Cap how many concurrent token-generating requests a provider may run. At the cap, further
      requests queue (oldest-agent-first); remove a limit to make a provider unlimited. Limits are
      in-memory only.
    </p>

    <!-- Add form -->
    <form
      class="flex flex-wrap items-end gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void handleAdd();
      }}
    >
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase opacity-60">Provider id</span>
        <input
          class="input input-bordered input-xs w-40 font-mono"
          placeholder="umans"
          autocomplete="off"
          spellcheck="false"
          bind:value={newProviderId}
          disabled={adding}
        />
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
    {:else if hasLoadedLimits && limitViews.length === 0 && !limitsLoading}
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
        disabled={statusLoading}
        onclick={() => refreshStatus()}
        aria-label="Refresh concurrency status"
      >
        {#if statusLoading}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          Refresh
        {/if}
      </button>
    </div>
    <p class="text-xs opacity-60">
      In-flight slots held vs the cap (e.g. 2/4), agents queued waiting, and a paused state when a
      provider backs off after a 429. Polls every 2s.
    </p>

    <span class="text-xs opacity-70">{statusSummary}</span>

    {#if statusError}
      <p class="text-xs text-error">{statusError}</p>
    {:else if hasLoadedStatus && statusViews.length === 0 && !statusLoading}
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
