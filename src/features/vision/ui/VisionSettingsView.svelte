<script lang="ts">
  import type { ModelMetadata } from "@dispatch/transport-contract";
  import {
    compactionModelChanged,
    compactionModelFromValue,
    compactionModelOptions,
    DEFAULT_IMAGE_LIMIT,
    imageLimitChanged,
    imageLimitLabel,
    parseImageLimit,
    selectedCompactionValue,
    type LoadVisionSettings,
    type SaveVisionSettings,
    type VisionSettings,
  } from "../logic/view-model";

  let {
    models,
    modelInfo = {},
    load,
    save,
  }: {
    /** The model catalog (`GET /models` `models`) — for the compaction-model dropdown. */
    models: readonly string[];
    /** Per-model metadata — to filter the dropdown to vision-capable models. */
    modelInfo?: Readonly<Record<string, ModelMetadata>>;
    /** Load the global vision settings (`GET /settings/vision`). */
    load: LoadVisionSettings;
    /** Save a partial vision-settings update (`PUT /settings/vision`). */
    save: SaveVisionSettings;
  } = $props();

  let settings = $state<VisionSettings | null>(null);
  let loadError = $state<string | null>(null);

  // imageLimit input state.
  let imageLimitInput = $state("");
  let savingImageLimit = $state(false);
  let imageLimitError = $state<string | null>(null);
  let imageLimitSaved = $state(false);

  // compactionModel select state.
  let compactionSaving = $state(false);
  let compactionError = $state<string | null>(null);
  let compactionSaved = $state(false);

  // Load on mount.
  $effect(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    const result = await load();
    if (result.ok) {
      settings = result.settings;
      imageLimitInput = String(result.settings.imageLimit);
      loadError = null;
      imageLimitError = null;
      imageLimitSaved = false;
      compactionError = null;
      compactionSaved = false;
    } else {
      loadError = result.error;
    }
  }

  const options = $derived(compactionModelOptions(models, modelInfo));
  const selectedCompaction = $derived(
    settings ? selectedCompactionValue(settings.compactionModel) : selectedCompactionValue(null),
  );
  const limitLabel = $derived(imageLimitLabel(settings?.imageLimit ?? null));

  const canSaveImageLimit = $derived(
    settings !== null && imageLimitChanged(imageLimitInput, settings.imageLimit),
  );

  async function handleSaveImageLimit(): Promise<void> {
    if (settings === null || savingImageLimit) return;
    const parsed = parseImageLimit(imageLimitInput);
    if (!parsed.ok) {
      imageLimitError = parsed.error;
      imageLimitSaved = false;
      return;
    }
    savingImageLimit = true;
    imageLimitError = null;
    imageLimitSaved = false;
    const result = await save({ imageLimit: parsed.value });
    savingImageLimit = false;
    if (result.ok) {
      settings = result.settings;
      imageLimitInput = String(result.settings.imageLimit);
      imageLimitSaved = true;
    } else {
      imageLimitError = result.error;
    }
  }

  async function handleCompactionChange(e: Event): Promise<void> {
    if (settings === null || compactionSaving) return;
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (!compactionModelChanged(value, settings.compactionModel)) return;
    compactionSaving = true;
    compactionError = null;
    compactionSaved = false;
    const result = await save({ compactionModel: compactionModelFromValue(value) });
    compactionSaving = false;
    if (result.ok) {
      settings = result.settings;
      compactionSaved = true;
    } else {
      compactionError = result.error;
    }
  }
</script>

<div class="flex flex-col gap-3">
  {#if loadError}
    <p class="text-xs text-error">{loadError}</p>
  {/if}

  {#if settings === null && !loadError}
    <p class="text-xs opacity-60">Loading vision settings…</p>
  {:else if settings !== null}
    <!-- imageLimit -->
    <section class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase opacity-60">Image limit</span>
      <div class="flex items-center gap-2">
        <input
          type="text"
          inputmode="numeric"
          class="input input-bordered input-sm w-24"
          placeholder={String(DEFAULT_IMAGE_LIMIT)}
          bind:value={imageLimitInput}
          disabled={savingImageLimit}
          aria-label="Image limit (max native images per turn)"
        />
        <button
          type="button"
          class="btn btn-sm btn-outline"
          disabled={!canSaveImageLimit || savingImageLimit}
          onclick={handleSaveImageLimit}
        >
          {#if savingImageLimit}
            <span class="loading loading-spinner loading-xs"></span>
            Saving…
          {:else}
            Save
          {/if}
        </button>
      </div>
      <p class="text-xs opacity-50">
        Current: {limitLabel}
        <br />
        Max native images per turn before the oldest are transcribed to text.
        0 disables compaction. Default is {DEFAULT_IMAGE_LIMIT}.
      </p>
      {#if imageLimitError}
        <p class="text-xs text-error">{imageLimitError}</p>
      {:else if imageLimitSaved}
        <p class="text-xs text-success">Saved.</p>
      {/if}
    </section>

    <!-- compactionModel -->
    <section class="flex flex-col gap-1">
      <span class="text-xs font-semibold uppercase opacity-60">Compaction model</span>
      <select
        class="select select-bordered select-sm w-full"
        value={selectedCompaction}
        disabled={compactionSaving}
        onchange={handleCompactionChange}
        aria-label="Compaction model (which vision model transcribes old images)"
      >
        {#each options as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      {#if compactionSaving}
        <p class="text-xs opacity-60">Saving…</p>
      {/if}
      <p class="text-xs opacity-50">
        The vision-capable model that transcribes old images to text. "Auto" lets the server choose.
      </p>
      {#if compactionError}
        <p class="text-xs text-error">{compactionError}</p>
      {:else if compactionSaved}
        <p class="text-xs text-success">Saved.</p>
      {/if}
    </section>
  {/if}
</div>
