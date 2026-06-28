<script lang="ts">
  import { untrack } from "svelte";
  import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
  import {
    autoReduceNotices,
    DEFAULT_COOLDOWN_MS,
    parseCooldownInput,
    parseLimitInput,
    providerOptions,
    summarizeLimits,
    viewConcurrencyLimits,
    viewConcurrencyStatus,
    type ConcurrencyStatusView,
  } from "../logic/view-model";
  import type {
    ConcurrencyLimitEntry,
    DeleteConcurrencyLimit,
    LoadConcurrencyLimits,
    LoadConcurrencyStatus,
    RestoreOutcome,
    SaveConcurrencyCooldown,
    SaveConcurrencyLimit,
  } from "../logic/types";
  import AutoReduceBanner from "./AutoReduceBanner.svelte";
  import ConcurrencyLimitRow from "./ConcurrencyLimitRow.svelte";

  let {
    models,
    loadLimits,
    saveLimit,
    deleteLimit,
    loadStatus,
    saveCooldown,
  }: {
    /** Available models (`<provider>/<model>`) — the source of provider ids for the Add dropdown. */
    models: readonly string[];
    loadLimits: LoadConcurrencyLimits;
    saveLimit: SaveConcurrencyLimit;
    deleteLimit: DeleteConcurrencyLimit;
    loadStatus: LoadConcurrencyStatus;
    saveCooldown: SaveConcurrencyCooldown;
  } = $props();

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

  // Add-row state. The provider id is chosen from a dropdown of known providers
  // (derived from the available models + any already-configured limit providers).
  // The row is revealed by the "Add" button; "Set" saves it, ✕ cancels.
  let addOpen = $state(false);
  let newProviderId = $state("");
  let newLimitInput = $state("");
  let newCooldownInput = $state("");
  let adding = $state(false);
  let addError = $state<string | null>(null);

  const providerOpts = $derived(providerOptions(models, limits));
  const limitViews = $derived(viewConcurrencyLimits(limits));
  const limitsSummary = $derived(summarizeLimits(limits));
  const parsedNewLimit = $derived(parseLimitInput(newLimitInput));
  const parsedNewCooldown = $derived(parseCooldownInput(newCooldownInput));
  /** Only send a cooldown PUT when the user moved it off the server default. */
  const newCooldownChanged = $derived(
    parsedNewCooldown !== null && parsedNewCooldown !== DEFAULT_COOLDOWN_MS,
  );
  const canSet = $derived(
    newProviderId !== "" &&
      parsedNewLimit !== null &&
      parsedNewCooldown !== null &&
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

  function startAdd(): void {
    addOpen = true;
    addError = null;
    newLimitInput = "";
    newCooldownInput = String(DEFAULT_COOLDOWN_MS);
    // newProviderId is kept valid (defaults to the first option) by the effect above.
  }

  function cancelAdd(): void {
    addOpen = false;
    addError = null;
    newLimitInput = "";
    newCooldownInput = "";
  }

  // "Set" on the add row: save the limit, then the cooldown (only when the user
  // moved it off the server default of 350ms — the backend defaults to 350 when a
  // limit is set, so an unchanged value needs no extra PUT). On full success the
  // add row closes + the limits/status reload (the new limit appears as a row).
  async function handleAdd(): Promise<void> {
    if (parsedNewLimit === null || parsedNewCooldown === null || newProviderId === "") return;
    adding = true;
    addError = null;
    const limitResult = await saveLimit(newProviderId, parsedNewLimit);
    if (!limitResult.ok) {
      adding = false;
      addError = limitResult.error;
      return;
    }
    if (newCooldownChanged) {
      const cooldownResult = await saveCooldown(newProviderId, parsedNewCooldown);
      adding = false;
      if (!cooldownResult.ok) {
        // The limit was saved (→ a row will appear after reload); the cooldown PUT
        // failed. Surface the error but keep the add row open so it's visible. The
        // user can edit the cooldown on the now-saved row.
        addError = cooldownResult.error;
        void refreshLimits();
        void refreshStatus();
        return;
      }
    } else {
      adding = false;
    }
    addOpen = false;
    newLimitInput = "";
    newCooldownInput = "";
    void refreshLimits();
    void refreshStatus();
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

  // Wrap the cooldown save so a successful PUT refreshes the live status (which
  // re-carries the new `cooldownMs`). The row still gets the result to drive its
  // own UI.
  async function cooldownSave(providerId: string, cooldownMs: number) {
    const result = await saveCooldown(providerId, cooldownMs);
    if (result.ok) {
      void refreshStatus();
    }
    return result;
  }

  // ── Live status (polls while mounted — seeds cooldown inputs + drives the
  //    auto-reduce banners; the poll is silent, no status cards) ────────────────
  let statusEntries = $state<readonly ConcurrencyStatusEntry[]>([]);
  let statusError = $state<string | null>(null);
  /** True after the first load settles (gates the empty state). */
  let hasLoadedStatus = $state(false);
  /** Re-entrancy guard for the 2s background poll (no UI — a visible loading
   *  indicator flickered every poll because the refresh is near-instant; it stays
   *  INVISIBLE, mirroring the heartbeat runs list). */
  let statusInFlight = false;

  // Per-provider status view (from the live status poll) so each saved limit row
  // renders its in-flight count + status badge + seeds its cooldown input. Null
  // when a provider has no status entry yet (the row falls back to Idle + the
  // server-default cooldown of 350).
  const statusByProvider = $derived.by(() => {
    const map = new Map<string, ConcurrencyStatusView>();
    for (const e of statusEntries) map.set(e.providerId, viewConcurrencyStatus(e));
    return map;
  });

  // ── Auto-reduce banners (persist while autoReduced===true; dismissible) ───────
  //
  // When a provider's limit is auto-reduced by a 429, `GET /concurrency/status`
  // carries `autoReduced: true` (+ `autoReducedFrom` + `notice`). We render a
  // banner per such provider. The banner is DISMISSIBLE: a dismissed provider
  // stays hidden while it remains auto-reduced (persist-while-true), and is
  // UN-dismissed the moment a poll shows it no longer auto-reduced — so a future
  // auto-reduce re-shows the banner. Restoring the limit (PUT) clears
  // `autoReduced` server-side → the next poll drops the banner automatically.
  //
  // The dismissed set is intentionally COMPONENT-LOCAL (NOT persisted to
  // localStorage / a module-global): it resets on remount (sidebar view switch /
  // reload). This is correct — `autoReduced` is a REAL persisted degraded state,
  // so re-showing the banner on a fresh mount reminds the user. Persisting a
  // dismissal across reloads would risk HIDING an ongoing degradation (a
  // footgun), and AGENTS.md forbids module-global ambient state. Mirrors the
  // component-local `limitsError`/`statusError` pattern.
  let dismissedAutoReduce = $state<ReadonlySet<string>>(new Set());

  const allNotices = $derived(autoReduceNotices(statusEntries));
  const visibleNotices = $derived(
    allNotices.filter((n) => !dismissedAutoReduce.has(n.providerId)),
  );

  // Reconcile the dismissed set against the live auto-reduced providers: keep a
  // dismissed entry ONLY while its provider is still auto-reduced. A provider
  // that has been restored (no longer in `allNotices`) is dropped from the
  // dismissed set so a future auto-reduce re-shows its banner.
  $effect(() => {
    const autoReducedIds = new Set(allNotices.map((n) => n.providerId));
    untrack(() => {
      let changed = false;
      const next = new Set<string>();
      for (const id of dismissedAutoReduce) {
        if (autoReducedIds.has(id)) next.add(id);
        else changed = true;
      }
      if (changed) dismissedAutoReduce = next;
    });
  });

  function dismissAutoReduce(providerId: string): void {
    if (dismissedAutoReduce.has(providerId)) return;
    dismissedAutoReduce = new Set([...dismissedAutoReduce, providerId]);
  }

  // "Restore to N" — PUT the limit back to `autoReducedFrom` via the limits
  // endpoint (a manual PUT clears `autoReduced` server-side). Refreshes limits +
  // status on success; the next status poll shows `autoReduced===false` and the
  // banner drops (the dismissed-set effect above un-dismisses it too). The banner
  // component owns its own restoring-spinner + inline error; on FAILURE the
  // outcome is bubbled back so the banner shows the error inline (instead of
  // silently re-enabling the button / surfacing it only in the limits section).
  async function restoreLimit(providerId: string, limit: number): Promise<RestoreOutcome> {
    const result = await saveLimit(providerId, limit);
    if (result.ok) {
      void refreshLimits();
      void refreshStatus();
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

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
  // alive (so a saved limit's cooldown input re-seeds + auto-reduce banners stay
  // fresh without a manual refresh). Runs once — no reactive deps read inside.
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
  <!-- Auto-reduce banners (appear when a provider's limit was auto-reduced by a 429) -->
  {#if visibleNotices.length > 0}
    <section class="flex flex-col gap-2" aria-label="Concurrency auto-reduce notices">
      {#each visibleNotices as notice (notice.providerId)}
        <AutoReduceBanner {notice} onRestore={restoreLimit} onDismiss={dismissAutoReduce} />
      {/each}
    </section>
  {/if}

  <!-- Limits (config) — a single list of editable rows. -->
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase opacity-60">Concurrency limits</h3>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={() => {
          void refreshLimits();
          void refreshStatus();
        }}
        aria-label="Refresh concurrency limits"
      >
        Refresh
      </button>
    </div>

    <span class="text-xs opacity-70">{limitsSummary}</span>

    {#if limitsError}
      <p class="text-xs text-error">{limitsError}</p>
    {:else if hasLoadedLimits && limitViews.length === 0 && !addOpen}
      <p class="text-xs opacity-60">No limits configured — providers run unlimited.</p>
    {/if}

    <ul class="flex flex-col gap-2">
      {#each limitViews as limit (limit.providerId)}
        <li>
          <ConcurrencyLimitRow
            {limit}
            status={statusByProvider.get(limit.providerId) ?? null}
            save={rowSave}
            saveCooldown={cooldownSave}
            remove={rowRemove}
          />
        </li>
      {/each}
    </ul>

    <!-- Add row: an "Add" button reveals a new item (dropdown + limit + cooldown
         + Set + ✕). Set saves the limit (+ cooldown when moved off the default);
         ✕ cancels the draft. -->
    {#if addOpen}
      <div class="flex flex-col gap-1 rounded-box bg-base-200 p-2 text-sm">
        <!-- All on one line — nowrap so the buttons never wrap (the provider
             dropdown shrinks via flex-1 + min-w-0). -->
        <div class="flex flex-nowrap items-center gap-2">
          <select
            class="select select-bordered select-xs min-w-0 flex-1 font-mono"
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
          <input
            type="text"
            inputmode="numeric"
            class="input input-bordered input-xs w-20 font-mono"
            placeholder="4"
            aria-label="New concurrency limit"
            bind:value={newLimitInput}
            disabled={adding}
          />
          <input
            type="text"
            inputmode="numeric"
            class="input input-bordered input-xs w-24 font-mono"
            aria-label="New release cooldown (ms)"
            bind:value={newCooldownInput}
            disabled={adding}
          />
          <span class="text-[10px] opacity-50">ms</span>
          <button type="button" class="btn btn-primary btn-xs" disabled={!canSet} onclick={handleAdd}>
            {#if adding}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              Set
            {/if}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs text-error"
            aria-label="Cancel add"
            disabled={adding}
            onclick={cancelAdd}
          >
            ✕
          </button>
        </div>
        {#if addError}
          <p class="font-mono text-xs text-error">{addError}</p>
        {/if}
      </div>
    {:else}
      <button type="button" class="btn btn-ghost btn-xs w-fit" onclick={startAdd}>
        + Add
      </button>
    {/if}
  </section>
</div>
