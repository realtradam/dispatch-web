<script lang="ts">
  import { untrack } from "svelte";
  import { parseCooldownInput } from "../logic/view-model";
  import type { SaveConcurrencyCooldown } from "../logic/types";

  let {
    providerId,
    cooldownMs,
    save,
  }: {
    /** The provider this cooldown row controls. */
    providerId: string;
    /** The current per-slot release cooldown (ms) from the live status poll. */
    cooldownMs: number;
    save: SaveConcurrencyCooldown;
  } = $props();

  // Inline-edit state: the raw text bound to the cooldown input. Seeded from the
  // row's canonical cooldownMs, but only while the field is untouched — so a
  // status-poll refresh re-syncs it without clobbering an in-flight edit. Mirrors
  // the ConcurrencyLimitRow / ChatLimitField seed pattern.
  let draft = $state("");
  let lastSeed = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  /** Brief "Saved." confirmation after a successful save; cleared on edit. */
  let justSaved = $state(false);

  $effect(() => {
    const incoming = String(cooldownMs);
    untrack(() => {
      if (draft === lastSeed) draft = incoming;
      lastSeed = incoming;
    });
  });

  const parsed = $derived(parseCooldownInput(draft));
  const dirty = $derived(parsed !== null && parsed !== cooldownMs);

  function onInput(): void {
    justSaved = false;
    error = null;
  }

  async function handleSave(): Promise<void> {
    if (parsed === null || parsed === cooldownMs) return;
    saving = true;
    error = null;
    const result = await save(providerId, parsed);
    saving = false;
    if (result.ok) {
      // Reflect the echoed cooldown back into the field immediately (the prop
      // also re-asserts it via the seed effect above once the parent reloads).
      draft = String(result.cooldownMs);
      lastSeed = draft;
      justSaved = true;
    } else {
      error = result.error;
    }
  }
</script>

<div class="flex items-center gap-2 text-xs">
  <span class="opacity-60">cooldown</span>
  <input
    type="text"
    inputmode="numeric"
    class="input input-bordered input-xs w-20 font-mono"
    aria-label={`Release cooldown (ms) for ${providerId}`}
    bind:value={draft}
    oninput={onInput}
    disabled={saving}
  />
  <span class="opacity-50">ms</span>
  <button
    type="button"
    class="btn btn-primary btn-xs"
    aria-label={`Save cooldown for ${providerId}`}
    disabled={!dirty || saving}
    onclick={handleSave}
  >
    {#if saving}
      <span class="loading loading-spinner loading-xs"></span>
    {:else}
      Save
    {/if}
  </button>
  {#if error}
    <span class="font-mono text-error">{error}</span>
  {:else if justSaved && !dirty}
    <span class="text-success">Saved.</span>
  {/if}
</div>
