<script lang="ts">
  import type { ReasoningEffort } from "@dispatch/transport-contract";
  import {
    effectiveSelection,
    isThinkingSelection,
    selectionOptions,
    type SaveThinkingSelection,
    type ThinkingSelection,
  } from "../reasoning-effort";

  let {
    persistedEffort,
    persistedThinking,
    save,
  }: {
    /** The conversation's persisted effort level, or null when never set (default applies). */
    persistedEffort: ReasoningEffort | null;
    /**
     * The conversation's persisted thinking flag, or null when never set
     * (thinking ON — the default). `false` ⇒ thinking disabled (the separate
     * "off" axis); the effort level is preserved across an off→on toggle.
     */
    persistedThinking: boolean | null;
    /** Persist a thinking selection (off or a level). */
    save: SaveThinkingSelection;
  } = $props();

  const options = selectionOptions();

  // The user's in-flight choice; null = mirror the (async-loaded) persisted
  // selection. Re-mounted per conversation, so there is no cross-tab bleed.
  let chosen = $state<ThinkingSelection | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let justSaved = $state(false);

  const selected = $derived(
    chosen ?? effectiveSelection(persistedEffort, persistedThinking),
  );

  async function handleChange(value: string) {
    if (!isThinkingSelection(value) || saving) return;
    chosen = value;
    saving = true;
    error = null;
    justSaved = false;
    const result = await save(value);
    saving = false;
    if (result === null) return;
    if (result.ok) {
      justSaved = true;
    } else {
      error = result.error;
      chosen = null; // revert to the persisted selection
    }
  }
</script>

<div class="flex flex-col gap-1">
  <span class="text-xs font-semibold uppercase opacity-60">Reasoning effort</span>
  <div class="flex items-center gap-2">
    <select
      class="select select-sm w-full"
      value={selected}
      disabled={saving}
      onchange={(e) => handleChange(e.currentTarget.value)}
      aria-label="Reasoning effort"
    >
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    {#if saving}
      <span class="loading loading-spinner loading-xs" aria-label="Saving reasoning effort"></span>
    {/if}
  </div>
  {#if error}
    <p class="text-xs text-error">{error}</p>
  {:else if justSaved}
    <p class="text-xs text-success">Saved — applies from the next turn.</p>
  {:else}
    <p class="text-xs opacity-50">
      How long the model thinks before answering. “Off” disables thinking entirely. Changing it can re-prefill the prompt cache once.
    </p>
  {/if}
</div>
