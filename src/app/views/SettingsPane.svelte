<script lang="ts">
  /**
   * The `settings` view — FE-local settings (the chat limit). Not
   * conversation-scoped (no {#key}: the chat limit is global). A chat-limit
   * RAISE refills the active chat (prepends older history) — the reader's
   * viewport is preserved over the prepend via the chat viewport bridge
   * (exactly like today's saveChatLimit).
   */
  import { tick } from "svelte";
  import { ChatLimitField, type ChatLimitSaveResult } from "../../features/settings";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  async function saveChatLimit(value: number): Promise<ChatLimitSaveResult> {
    const el = ports.chatViewport.el;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    const result = await store.setChatLimit(value);
    await tick();
    if (el) {
      const delta = el.scrollHeight - prevHeight;
      if (delta > 0) el.scrollTop = prevTop + delta;
    }
    return result.ok
      ? { ok: true, chatLimit: result.chatLimit }
      : { ok: false, error: result.error };
  }
</script>

<div class="flex flex-col gap-3">
  <ChatLimitField chatLimit={store.chatLimit} save={saveChatLimit} />
</div>
