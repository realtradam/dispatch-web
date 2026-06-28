<script lang="ts">
  import { untrack } from "svelte";
  import {
    DEFAULT_COOLDOWN_MS,
    parseCooldownInput,
    parseLimitInput,
    statusLabel,
    type Badge,
    type ConcurrencyLimitView,
    type ConcurrencyStatusView,
  } from "../logic/view-model";
  import type {
    DeleteConcurrencyLimit,
    SaveConcurrencyCooldown,
    SaveConcurrencyLimit,
  } from "../logic/types";

  let {
    limit,
    status,
    save,
    saveCooldown,
    remove,
  }: {
    /** The configured limit row (providerId + current limit). */
    limit: ConcurrencyLimitView;
    /** The provider's live status view (in-flight/queue/badge), or null when no
     *  status entry exists yet. Drives the status line + seeds the cooldown input. */
    status: ConcurrencyStatusView | null;
    save: SaveConcurrencyLimit;
    saveCooldown: SaveConcurrencyCooldown;
    remove: DeleteConcurrencyLimit;
  } = $props();

  // The badge→color map (presentational). Mirrors the old status-card mapping.
  const badgeClass: Record<Badge, string> = {
    success: "badge-success",
    warning: "badge-warning",
    error: "badge-error",
    neutral: "badge-ghost",
  };

  // The cooldown input seed: the live cooldown when a status entry exists, else
  // the server default (350).
  const cooldownMs = $derived(status?.cooldownMs ?? DEFAULT_COOLDOWN_MS);

  // Inline-edit state for the limit + cooldown inputs. Each is seeded from its
  // canonical value, but only while untouched — so a save echo / status-poll
  // refresh re-syncs without clobbering an in-flight edit. Mirrors the
  // ChatLimitField seed pattern (avoids reading the prop in the $state init).
  let limitDraft = $state("");
  let lastLimitSeed = $state("");
  let cooldownDraft = $state("");
  let lastCooldownSeed = $state("");
  let saving = $state(false);
  let removing = $state(false);
  let error = $state<string | null>(null);
  /** Brief "Saved" confirmation after a successful save; cleared on edit. */
  let justSaved = $state(false);

  $effect(() => {
    const incomingLimit = String(limit.limit);
    const incomingCooldown = String(cooldownMs);
    untrack(() => {
      if (limitDraft === lastLimitSeed) limitDraft = incomingLimit;
      lastLimitSeed = incomingLimit;
      if (cooldownDraft === lastCooldownSeed) cooldownDraft = incomingCooldown;
      lastCooldownSeed = incomingCooldown;
    });
  });

  const parsedLimit = $derived(parseLimitInput(limitDraft));
  const parsedCooldown = $derived(parseCooldownInput(cooldownDraft));
  const dirtyLimit = $derived(parsedLimit !== null && parsedLimit !== limit.limit);
  const dirtyCooldown = $derived(parsedCooldown !== null && parsedCooldown !== cooldownMs);
  const dirty = $derived(dirtyLimit || dirtyCooldown);

  // Clear the "Saved" hint + any error as soon as the user edits either field.
  function onInput(): void {
    justSaved = false;
    error = null;
  }

  // "Set" saves whichever field is dirty: the limit first (PUT
  // /concurrency/limits/:id), then the cooldown (PUT /concurrency/cooldown/:id).
  // Stops + surfaces an inline error on the first failure.
  async function handleSet(): Promise<void> {
    if (!dirty || saving || removing) return;
    saving = true;
    error = null;
    try {
      if (dirtyLimit && parsedLimit !== null) {
        const r = await save(limit.providerId, parsedLimit);
        if (!r.ok) {
          error = r.error;
          return;
        }
        // Reflect the echoed limit back immediately (the prop re-asserts it via
        // the seed effect once the parent reloads).
        limitDraft = String(r.limit);
        lastLimitSeed = limitDraft;
      }
      if (dirtyCooldown && parsedCooldown !== null) {
        const r = await saveCooldown(limit.providerId, parsedCooldown);
        if (!r.ok) {
          error = r.error;
          return;
        }
        cooldownDraft = String(r.cooldownMs);
        lastCooldownSeed = cooldownDraft;
      }
      justSaved = true;
    } finally {
      saving = false;
    }
  }

  async function handleRemove(): Promise<void> {
    removing = true;
    error = null;
    const result = await remove(limit.providerId);
    removing = false;
    if (!result.ok) {
      error = result.error;
    }
    // On success the parent drops this row (re-loaded limits list).
  }
</script>

<div class="flex flex-col gap-1 rounded-box bg-base-200 p-2 text-sm">
  <!-- Line 1: provider + limit + cooldown + Set + ✕ (all on one line — nowrap so
       the buttons never wrap; the provider shrinks via flex-1 + min-w-0). -->
  <div class="flex flex-nowrap items-center gap-2">
    <span class="min-w-0 flex-1 truncate font-medium font-mono" title={limit.providerId}
      >{limit.providerId}</span
    >
    <input
      type="text"
      inputmode="numeric"
      class="input input-bordered input-xs w-20 font-mono"
      aria-label={`Concurrency limit for ${limit.providerId}`}
      bind:value={limitDraft}
      oninput={onInput}
      disabled={saving || removing}
    />
    <input
      type="text"
      inputmode="numeric"
      class="input input-bordered input-xs w-24 font-mono"
      aria-label={`Release cooldown (ms) for ${limit.providerId}`}
      bind:value={cooldownDraft}
      oninput={onInput}
      disabled={saving || removing}
    />
    <span class="text-[10px] opacity-50">ms</span>
    <button
      type="button"
      class="btn btn-primary btn-xs"
      aria-label={`Set concurrency for ${limit.providerId}`}
      disabled={!dirty || saving || removing}
      onclick={handleSet}
    >
      {#if saving}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        Set
      {/if}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs text-error"
      aria-label={`Remove concurrency limit for ${limit.providerId}`}
      disabled={saving || removing}
      onclick={handleRemove}
    >
      {#if removing}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        ✕
      {/if}
    </button>
  </div>

  <!-- Line 2: in-flight count (left) + status badge (right). Hidden until the
       first status poll for this provider lands. -->
  {#if status !== null}
    <div class="flex items-center justify-between gap-2 text-xs opacity-70">
      <span title="In-flight slots held vs cap">{status.inFlightLabel} in flight</span>
      <span class="badge badge-sm {badgeClass[status.badge]} gap-1">
        {#if status.busy}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        {statusLabel(status)}
      </span>
    </div>
  {/if}

  {#if error}
    <span class="font-mono text-xs text-error">{error}</span>
  {:else if justSaved && !dirty}
    <span class="text-xs text-success">Saved.</span>
  {/if}
</div>
