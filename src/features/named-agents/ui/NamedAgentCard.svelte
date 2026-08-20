<script lang="ts">
  import type { NamedAgent } from "../logic/types";
  import type { CardController } from "./controller.svelte";
  import {
    modelsForProvider,
    providerLabel,
    providerOptions,
    fullModelFromSelection,
  } from "../logic/options";
  import { draftValidity } from "../logic/auto-save";
  import { saveStatusLabel } from "../logic/auto-save";

  let {
    models,
    agent,
    controller,
    otherNames,
  }: {
    /** Available models (`<provider>/<model>`) — the source of the provider/model dropdowns. */
    models: readonly string[];
    /** The persisted agent this card edits, or null for a new draft. */
    agent: NamedAgent | null;
    /** The card's auto-save controller (draft + status + save lifecycle). */
    controller: CardController;
    /** The OTHER agents' names (excludes this card) for the uniqueness hint. */
    otherNames: readonly string[];
  } = $props();

  const providers = $derived(providerOptions(models));
  const providerModels = $derived(modelsForProvider(models, controller.draft.provider));
  // The full model string a provider+model selection maps to (for the "unavailable"
  // fallback when the saved model leaves the catalog).
  const fullModel = $derived(
    fullModelFromSelection(controller.draft.provider, controller.draft.model),
  );
  const validity = $derived(draftValidity(controller.draft, otherNames));
  const statusLabel = $derived(saveStatusLabel(controller.save.status));
  // Whether the current provider+model actually resolves inside the catalog.
  const selectedResolves = $derived(
    controller.draft.provider !== "" &&
      modelsForProvider(models, controller.draft.provider).includes(controller.draft.model),
  );
</script>

<div class="flex flex-col gap-1 rounded-box bg-base-200 p-3">
  <span class="text-[10px] uppercase opacity-60">Name</span>
  <input
    type="text"
    class="input input-bordered input-sm w-full"
    placeholder="Enter a name…"
    aria-label="Named agent name"
    value={controller.draft.name}
    oninput={(e) => controller.setName(e.currentTarget.value)}
  />

  <span class="mt-1 text-[10px] uppercase opacity-60">Provider</span>
  <select
    class="select select-bordered select-sm w-full"
    aria-label="Named agent provider"
    value={controller.draft.provider}
    onchange={(e) => controller.setProvider(e.currentTarget.value)}
  >
    {#if controller.draft.provider === ""}
      <option value="" disabled>Select provider…</option>
    {/if}
    {#each providers as provider (provider)}
      <option value={provider}>{providerLabel(provider)}</option>
    {/each}
  </select>

  <span class="mt-1 text-[10px] uppercase opacity-60">Model</span>
  <select
    class="select select-bordered select-sm w-full"
    aria-label="Named agent model"
    value={controller.draft.model}
    disabled={controller.draft.provider === ""}
    onchange={(e) => controller.setModel(e.currentTarget.value)}
  >
    {#if controller.draft.provider === ""}
      <option value="" disabled>Select provider first</option>
    {:else if controller.draft.model === ""}
      <option value="" disabled>Select a model…</option>
    {/if}
    {#each providerModels as model (model)}
      <option value={model}>{model}</option>
    {/each}
    {#if !selectedResolves && controller.draft.model !== ""}
      <!-- The saved selection is no longer in the live catalog (its provider/
           credential was removed) — keep showing it as unavailable rather than
           silently rewriting it. -->
      <option value={controller.draft.model} disabled>
        {fullModel} (unavailable)
      </option>
    {/if}
  </select>

  {#if !validity.usable && validity.message !== null}
    <p class="mt-1 text-xs text-warning" role="status">{validity.message}</p>
  {/if}

  <div class="mt-2 flex items-center justify-between gap-2">
    <span
      class="text-xs"
      class:text-error={controller.save.status === "error" && controller.save.error !== null}
      class:opacity-60={controller.save.status !== "saving" && controller.save.status !== "error"}
      role="status"
    >
      {statusLabel}{#if controller.save.error !== null}: {controller.save.error}{/if}
    </span>
    <button
      type="button"
      class="btn btn-ghost btn-xs text-error"
      aria-label="Remove named agent"
      disabled={controller.saving}
      onclick={() => controller.remove()}
    >
      Remove
    </button>
  </div>
</div>