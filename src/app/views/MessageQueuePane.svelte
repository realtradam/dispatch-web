<script lang="ts">
  /**
   * The `message-queue` view — pending steering messages, rendered via the
   * generic SurfaceView (dispatches on rendererId, never surface id). The
   * non-empty conditional moved INSIDE the view (decision 4): the tree's leaf
   * always exists; an idle queue renders NOTHING.
   */
  import { SurfaceView } from "../../features/surface-host";
  import { parseMessageQueuePayload } from "../../features/surface-host/logic/message-queue";
  import type { AppViewPorts } from "../view-ports";

  // The message-queue extension's per-conversation surface (steering). Pulled
  // out of the generic Extensions list — pending steering messages are tied to
  // the chat, not the sidebar.
  const MESSAGE_QUEUE_ID = "message-queue";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // The surface spec + whether it currently has pending messages.
  const messageQueueSpec = $derived(store.surface(MESSAGE_QUEUE_ID));
  const hasQueuedMessages = $derived.by(() => {
    const spec = messageQueueSpec;
    if (spec === null) return false;
    const field = spec.fields.find((f) => f.kind === "custom" && f.rendererId === MESSAGE_QUEUE_ID);
    if (field === undefined || field.kind !== "custom") return false;
    const data = parseMessageQueuePayload(field.payload);
    return data !== null && data.messages.length > 0;
  });
</script>

{#if hasQueuedMessages && messageQueueSpec !== null}
  <div class="px-4 pt-2">
    <SurfaceView
      spec={messageQueueSpec}
      onInvoke={(msg) => store.invoke(msg.surfaceId, msg.actionId, msg.payload)}
      onCancelQueuedMessage={(messageId) => store.cancelQueuedMessage(messageId)}
    />
  </div>
{/if}
