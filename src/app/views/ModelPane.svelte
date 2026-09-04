<script lang="ts">
  /**
   * The `model` view — the model selector + the per-conversation
   * reasoning-effort / cwd / computer controls, with the store adapters that
   * used to live in App.svelte. The controls re-mount per workspace
   * conversation (the {#key} moved inside the wrapper) so inputs can't bleed
   * across tabs — editable for a draft too.
   */
  import {
    ModelSelector,
    ReasoningEffortSelector,
    type ThinkingSelection,
    type ThinkingSelectionSaveResult,
  } from "../../features/chat";
  import { CwdField, type CwdSaveResult } from "../../features/cwd-lsp";
  import {
    ComputerField,
    type ComputerSaveResult,
    type ComputerStatusResult,
    type LoadComputerStatus,
    type SaveComputer,
    type TestComputer,
    type TestComputerResult,
  } from "../../features/computer";
  import type { NamedAgentSelectionSnapshot } from "../../features/named-agents";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  function handleSelectModel(model: string): void {
    store.selectModel(model);
  }

  // A Named Agent selected in the model selector: resolve it to its raw model
  // AND record the snapshot on the active conversation (plan §6/§7). The store
  // persists the raw model to `/conversations/:id/model` + retains the snapshot
  // on the tab.
  function handleSelectNamedAgent(snapshot: NamedAgentSelectionSnapshot): void {
    store.selectModel(snapshot.model, snapshot);
  }

  // Adapt the store's reasoning-effort + thinking results to the chat
  // feature's combined selector port. The selector sends ONE selection ("off"
  // or a level); the adapter fans it out to the right per-axis PUT(s). "off" is
  // a SEPARATE signal from the effort level: it persists `thinking: false`
  // (the umans route maps that to `reasoning_effort: "none"`), leaving the
  // effort level untouched so an off→on toggle restores it. A level ensures
  // thinking is ON (the level is meaningless while thinking is off) then sets
  // the effort level.
  async function saveThinkingSelection(
    selection: ThinkingSelection,
  ): Promise<ThinkingSelectionSaveResult | null> {
    if (selection === "off") {
      const result = await store.setThinking(false);
      if (result === null) return null;
      return result.ok
        ? { ok: true, selection: "off" }
        : { ok: false, error: result.error };
    }
    // A level: enable thinking first if it is currently off, then set the level.
    if (store.thinking === false) {
      const on = await store.setThinking(true);
      if (on !== null && !on.ok) {
        return { ok: false, error: on.error };
      }
    }
    const result = await store.setReasoningEffort(selection);
    if (result === null) return null;
    return result.ok
      ? { ok: true, selection: result.reasoningEffort }
      : { ok: false, error: result.error };
  }

  async function saveCwd(cwd: string): Promise<CwdSaveResult | null> {
    const result = await store.setCwd(cwd);
    if (result === null) return null;
    return result.ok ? { ok: true, cwd: result.cwd } : { ok: false, error: result.error };
  }

  async function saveComputer(computerId: string | null): Promise<ComputerSaveResult | null> {
    const result = await store.setComputer(computerId);
    if (result === null) return null;
    return result.ok ? { ok: true, computerId: result.computerId } : { ok: false, error: result.error };
  }

  const loadComputerStatus: LoadComputerStatus = async (
    alias: string,
  ): Promise<ComputerStatusResult | null> => {
    const result = await store.computerStatus(alias);
    if (result === null) return null;
    return result.ok ? { ok: true, status: result.response } : { ok: false, error: result.error };
  };

  const testComputer: TestComputer = async (
    alias: string,
  ): Promise<TestComputerResult | null> => {
    const result = await store.testComputer(alias);
    if (result === null) return null;
    return result.ok ? { ok: true, response: result.response } : { ok: false, error: result.error };
  };
</script>

<div class="flex flex-col gap-3">
  <ModelSelector
    models={store.models}
    selected={store.activeModel}
    onSelect={handleSelectModel}
    modelInfo={store.modelInfo}
    namedAgents={store.namedAgents}
    namedAgentSnapshot={store.namedAgentSnapshot}
    onSelectNamedAgent={handleSelectNamedAgent}
    zeroProviders={store.enabledProviderCount === 0}
  />
  {#key store.currentConversationId}
    <ReasoningEffortSelector
      persistedEffort={store.reasoningEffort}
      persistedThinking={store.thinking}
      save={saveThinkingSelection}
    />
    <CwdField cwd={store.cwd} canEdit={true} save={saveCwd} />
    <ComputerField
      computerId={store.computerId}
      canEdit={true}
      computers={store.computers}
      save={saveComputer}
      loadStatus={loadComputerStatus}
      test={testComputer}
    />
  {/key}
</div>
