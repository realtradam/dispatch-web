<script lang="ts">
  import { untrack } from "svelte";
  import { parseLimitInput, type ConcurrencyLimitView } from "../logic/view-model";
  import type { DeleteConcurrencyLimit, SaveConcurrencyLimit } from "../logic/types";

  let {
    limit,
    save,
    remove,
  }: {
    /** The configured limit row (providerId + current limit). */
    limit: ConcurrencyLimitView;
    save: SaveConcurrencyLimit;
    remove: DeleteConcurrencyLimit;
  } = $props();

  // Inline-edit state: the raw text bound to the limit input. Seeded from the
  // row's canonical limit, but only while the field is untouched — so a save
  // echo / list refresh re-syncs it without clobbering an in-flight edit. Mirrors
  // the ChatLimitField seed pattern (avoids reading the prop in the $state init).
  let draft = $state("");
  let lastSeed = $state("");
  let saving = $state(false);
  let removing = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const incoming = String(limit.limit);
    untrack(() => {
      if (draft === lastSeed) draft = incoming;
      lastSeed = incoming;
    });
  });

  const parsed = $derived(parseLimitInput(draft));
  const dirty = $derived(parsed !== null && parsed !== limit.limit);

  async function handleSave(): Promise<void> {
    if (parsed === null || parsed === limit.limit) return;
    saving = true;
    error = null;
    const result = await save(limit.providerId, parsed);
    saving = false;
    if (result.ok) {
      // Reflect the echoed limit back into the field immediately (the prop will
      // also re-assert it via the seed effect above once the parent reloads).
      draft = String(result.limit);
      lastSeed = draft;
    } else {
      error = result.error;
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
  <div class="flex items-center gap-2">
    <span class="flex-1 truncate font-medium font-mono" title={limit.providerId}>{limit.providerId}</span>
    <input
      type="text"
      inputmode="numeric"
      class="input input-bordered input-xs w-20 font-mono"
      aria-label={`Concurrency limit for ${limit.providerId}`}
      bind:value={draft}
      disabled={saving || removing}
    />
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={!dirty || saving || removing}
      onclick={handleSave}
    >
      {#if saving}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        Save
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
  {#if error}
    <span class="font-mono text-xs text-error">{error}</span>
  {/if}
</div>
