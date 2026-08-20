<script lang="ts">
  import type { ModelMetadata } from "@dispatch/transport-contract";
  import type { NamedAgent, NamedAgentSelectionSnapshot } from "../../named-agents";
  import {
    isNamedAgentSelection,
    isVisionModel,
    joinModelName,
    modelKeyLabel,
    modelsForKey,
    NAMED_AGENTS_PROVIDER,
    namedAgentNames,
    namedAgentSelectionLabel,
    providerKeysWithNamedAgents,
    splitModelName,
  } from "../model-select";

  let {
    models,
    selected,
    onSelect,
    modelInfo = {},
    namedAgents = [],
    namedAgentSnapshot = null,
    onSelectNamedAgent,
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
    /** The user-curated Named Agents (plan §6) offered under the synthetic provider. */
    namedAgents?: readonly NamedAgent[];
    /** The active conversation's Named Agent snapshot (null when not selected via one). */
    namedAgentSnapshot?: NamedAgentSelectionSnapshot | null;
    /** Called when a Named Agent is selected (the selector resolves it to a raw model + snapshot). */
    onSelectNamedAgent?: (snapshot: NamedAgentSelectionSnapshot) => void;
  } = $props();

  // Whether the current selection is a Named Agent snapshot (the conversation was
  // selected via one; its captured raw model equals `selected`).
  const currentIsNamedAgent = $derived(isNamedAgentSelection(selected, namedAgentSnapshot));

  const providerKeys = $derived(providerKeysWithNamedAgents(models));
  const current = $derived(splitModelName(selected));
  const keyModels = $derived(modelsForKey(models, current.key));

  // The provider shown in the provider dropdown: the synthetic Named Agents
  // provider when the selection is a Named Agent snapshot, else the raw key.
  const currentProvider = $derived(
    currentIsNamedAgent || current.key === NAMED_AGENTS_PROVIDER
      ? NAMED_AGENTS_PROVIDER
      : current.key,
  );

  const namedNames = $derived(namedAgentNames(namedAgents));

  // Whether the currently-selected full model name is vision-capable.
  const selectedVision = $derived(isVisionModel(modelInfo, selected));

  // Whether the currently-selected raw model is PRESENT in the catalog (only
  // meaningful for a raw selection — a Named Agent snapshot resolves to a raw
  // model that may have left the catalog).
  const rawMissing = $derived(
    !currentIsNamedAgent && selected !== "" && !models.includes(selected),
  );
  const keyUnavailable = $derived(
    !currentIsNamedAgent && selected !== "" && !providerKeys.includes(current.key),
  );

  // Switching provider. Going TO the Named Agents provider: jump to the first
  // Named Agent (mirrors selectKey jumping to the first model); the model
  // dropdown then lists named names. Going to a raw provider: existing behavior.
  function selectProvider(key: string): void {
    if (key === currentProvider) return;
    if (key === NAMED_AGENTS_PROVIDER) {
      selectFirstNamedAgent();
      return;
    }
    const first = modelsForKey(models, key)[0] ?? "";
    onSelect(joinModelName(key, first));
  }

  // Selecting a raw model suffix under the current raw provider.
  function selectRawModel(model: string): void {
    onSelect(joinModelName(current.key, model));
  }

  // Selecting a Named Agent name (under the synthetic provider): resolve it to a
  // snapshot + raw model and report via onSelectNamedAgent.
  function selectNamedAgent(name: string): void {
    const agent = namedAgents.find((a) => a.name === name);
    if (agent === undefined) return;
    onSelectNamedAgent?.({
      namedAgentId: agent.id,
      namedAgentName: agent.name,
      model: agent.model,
    });
  }

  // Jump to the first configured Named Agent (used when the provider is switched
  // to Named Agents), matching the raw-provider "jump to first model" behavior.
  function selectFirstNamedAgent(): void {
    const first = namedAgents[0];
    if (first === undefined) return; // no named agents — the model dropdown shows the disabled placeholder
    onSelectNamedAgent?.({
      namedAgentId: first.id,
      namedAgentName: first.name,
      model: first.model,
    });
  }

  // The full `<provider>/<model>` name for a raw model suffix under `current.key`.
  function fullNameFor(modelSuffix: string): string {
    return joinModelName(current.key, modelSuffix);
  }
</script>

<div class="flex flex-col gap-2">
  <select
    class="select w-full"
    value={currentProvider}
    onchange={(e) => selectProvider(e.currentTarget.value)}
    aria-label="Key selector"
  >
    {#if keyUnavailable && currentProvider !== NAMED_AGENTS_PROVIDER}
      <option value={current.key} disabled>{modelKeyLabel(current.key)} (unavailable)</option>
    {/if}
    {#each providerKeys as key (key)}
      <option value={key}>
        {key === NAMED_AGENTS_PROVIDER ? "Named Agents" : modelKeyLabel(key)}
      </option>
    {/each}
  </select>

  <select
    class="select w-full"
    value={currentIsNamedAgent ? (namedAgentSnapshot?.namedAgentName ?? "") : current.model}
    onchange={
      currentIsNamedAgent
        ? (e) => selectNamedAgent(e.currentTarget.value)
        : (e) => selectRawModel(e.currentTarget.value)
    }
    aria-label="Model selector"
    disabled={currentProvider === NAMED_AGENTS_PROVIDER && namedAgents.length === 0}
  >
    {#if currentProvider === NAMED_AGENTS_PROVIDER}
      {#if namedAgents.length === 0 && !currentIsNamedAgent}
        <option value="" disabled>No named agents configured</option>
      {:else}
        {#each namedNames as name (name)}
          <option value={name}>{namedAgentSelectionLabel(name)}</option>
        {/each}
        {#if currentIsNamedAgent && !namedNames.includes(namedAgentSnapshot?.namedAgentName ?? "")}
          <!-- The selected Named Agent was renamed/removed — keep showing the
               captured snapshot name rather than silently switching (plan §7). -->
          <option value={namedAgentSnapshot?.namedAgentName ?? ""} disabled>
            {namedAgentSelectionLabel(namedAgentSnapshot?.namedAgentName ?? "")} (unavailable)
          </option>
        {/if}
      {/if}
    {:else}
      {#each keyModels as model (model)}
        <option value={model}>
          {model}{#if isVisionModel(modelInfo, fullNameFor(model))} · vision{/if}
        </option>
      {/each}
      {#if rawMissing && !keyUnavailable}
        <option value={current.model} disabled>{current.model} (unavailable)</option>
      {/if}
    {/if}
  </select>

  {#if rawMissing}
    <div class="text-xs text-warning" role="status">
      Selected model “{selected}” is unavailable — choose another credential.
    </div>
  {/if}

  {#if currentIsNamedAgent}
    <div class="text-xs text-base-content/40">
      Selected via <strong>Named Agents</strong> — snapshot of {namedAgentSnapshot?.namedAgentName}.
    </div>
  {/if}

  {#if !currentIsNamedAgent}
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
  {/if}
</div>