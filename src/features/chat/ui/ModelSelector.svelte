<script lang="ts">
  import type { ModelMetadata } from "@dispatch/transport-contract";
  import {
    isVisionModel,
    joinModelName,
    modelKeyLabel,
    modelKeys,
    modelsForKey,
    splitModelName,
  } from "../model-select";

  let {
    models,
    selected,
    onSelect,
    modelInfo = {},
  }: {
    models: readonly string[];
    selected: string;
    onSelect: (model: string) => void;
    /**
     * Per-model metadata from `GET /models` (`{ [name]: ModelMetadata }`).
     * Used to show a "vision" badge next to models with `vision: true` (they
     * natively accept images; others rely on the server's vision handoff).
     * Optional — absent metadata → no badge (treated as non-vision).
     */
    modelInfo?: Readonly<Record<string, ModelMetadata>>;
  } = $props();

  const keys = $derived(modelKeys(models));
  const current = $derived(splitModelName(selected));
  const keyModels = $derived(modelsForKey(models, current.key));

  // Whether the currently-selected full model name is vision-capable.
  const selectedVision = $derived(isVisionModel(modelInfo, selected));

  // Whether the currently-selected full name is PRESENT in the catalog. When a
  // saved credential/model disappears, we show it as unavailable rather than
  // silently switching to something else.
  const selectedUnavailable = $derived(selected !== "" && !models.includes(selected));
  // The key part is itself missing from the catalog (e.g. a whole numbered
  // OpenCode credential was removed).
  const keyUnavailable = $derived(selected !== "" && !keys.includes(current.key));

  // Switching key jumps to the first model available under it.
  function selectKey(key: string): void {
    if (key === current.key) return;
    const first = modelsForKey(models, key)[0] ?? "";
    onSelect(joinModelName(key, first));
  }

  function selectModel(model: string): void {
    onSelect(joinModelName(current.key, model));
  }

  // The full `<key>/<model>` name for a model suffix under the current key.
  function fullNameFor(modelSuffix: string): string {
    return joinModelName(current.key, modelSuffix);
  }
</script>

<div class="flex flex-col gap-2">
  <select
    class="select w-full"
    value={current.key}
    onchange={(e) => selectKey(e.currentTarget.value)}
    aria-label="Key selector"
  >
    {#if keyUnavailable}
      <option value={current.key} disabled>{modelKeyLabel(current.key)} (unavailable)</option>
    {/if}
    {#each keys as key (key)}
      <option value={key}>{modelKeyLabel(key)}</option>
    {/each}
  </select>
  <select
    class="select w-full"
    value={current.model}
    onchange={(e) => selectModel(e.currentTarget.value)}
    aria-label="Model selector"
  >
    {#each keyModels as model (model)}
      <option value={model}>
        {model}{#if isVisionModel(modelInfo, fullNameFor(model))} · vision{/if}
      </option>
    {/each}
    {#if selectedUnavailable && !keyUnavailable}
      <option value={current.model} disabled>{current.model} (unavailable)</option>
    {/if}
  </select>
  {#if selectedUnavailable}
    <div class="text-xs text-warning" role="status">
      Selected model “{selected}” is unavailable — choose another credential.
    </div>
  {/if}
  {#if selectedVision}
    <div class="flex items-center gap-1 text-xs text-base-content/60">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
      <span>Vision — this model sees images natively</span>
    </div>
  {:else}
    <div class="text-xs text-base-content/40">
      Pasted images are auto-described (vision handoff)
    </div>
  {/if}
</div>
