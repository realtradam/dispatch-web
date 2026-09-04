<script lang="ts">
  /**
   * The `compaction` view — message compaction with the store adapters.
   * Per-conversation (keyed so the percent + feedback can't bleed across tabs;
   * the {#key} moved inside the wrapper).
   */
  import {
    CompactionView,
    type CompactNowResult,
    type SaveCompactPercentResult,
  } from "../../features/chat";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // Adapt the store's compact result to the compaction view's port.
  async function compactNow(): Promise<CompactNowResult | null> {
    const result = await store.compactNow();
    if (result === null) return null;
    return result.ok
      ? {
          ok: true,
          messagesSummarized: result.response.messagesSummarized,
          messagesKept: result.response.messagesKept,
        }
      : { ok: false, error: result.error };
  }

  async function saveCompactPercent(
    percent: number,
  ): Promise<SaveCompactPercentResult | null> {
    const result = await store.setCompactPercent(percent);
    if (result === null) return null;
    return result.ok
      ? { ok: true, percent: result.percent }
      : { ok: false, error: result.error };
  }
</script>

{#key store.currentConversationId}
  <CompactionView
    percent={store.compactPercent}
    canCompact={store.activeConversationId !== null}
    {compactNow}
    savePercent={saveCompactPercent}
  />
{/key}
