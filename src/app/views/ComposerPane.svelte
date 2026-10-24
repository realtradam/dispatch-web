<script lang="ts">
  /**
   * The `composer` view — the send box with the status derivation that used to
   * live in App.svelte (error > queued > running > idle) and the
   * send/queue/stop ports. Not conversation-scoped (no {#key}) — the composer
   * is a persistent column fixture, exactly like today.
   */
  import { Composer, type ComposerStatus } from "../../features/chat";
  import { MESSAGE_QUEUE_RENDERER_ID, messageQueueCount } from "../../features/surface-host";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  const queuedMessageCount = $derived(
    store.activeConversationId === null
      ? undefined
      : messageQueueCount(store.surface(MESSAGE_QUEUE_RENDERER_ID, store.activeConversationId)),
  );

  // Priority: error > queued > running > idle. `queued` (the turn is in flight
  // but waiting for a concurrency slot — CR-13) wins over `running` so the
  // corner shows a ring, not dots, during the wait. `turn-start` fires before
  // the slot is granted, so `generating` is already true while
  // `conversationStatus === "queued"`; the explicit queued check is what
  // distinguishes the two.
  const composerStatus = $derived.by<ComposerStatus>(() => {
    if (store.activeChat.error) return "error";
    const id = store.activeConversationId;
    if (id !== null && store.conversationStatus(id) === "queued") return "queued";
    return store.activeChat.generating ? "running" : "idle";
  });
</script>

<Composer
  onSend={(text, images) => store.send(text, images)}
  onQueue={(text, images) => store.queueMessage(text, images)}
  onStop={() => store.stopGeneration()}
  contextSize={store.activeChat.currentContextSize}
  contextWindow={store.modelInfo[store.activeModel]?.contextWindow}
  {queuedMessageCount}
  status={composerStatus}
/>
