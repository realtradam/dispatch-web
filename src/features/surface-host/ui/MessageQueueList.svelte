<script lang="ts">
  import { parseMessageQueuePayload } from "../logic/message-queue";

  let { payload }: { readonly payload: unknown } = $props();

  // Parse defensively; an unparseable payload yields null → render nothing
  // (graceful skip, per the custom-field contract).
  const data = $derived(parseMessageQueuePayload(payload));
</script>

{#if data !== null && data.messages.length > 0}
  <ul class="flex flex-col gap-1 text-sm">
    {#each data.messages as msg (msg.id)}
      <li class="rounded-box bg-base-200 px-3 py-2">
        <p class="whitespace-pre-wrap">{msg.text}</p>
        <time class="text-xs opacity-50" datetime={new Date(msg.queuedAt).toISOString()}>
          {new Date(msg.queuedAt).toLocaleTimeString()}
        </time>
      </li>
    {/each}
  </ul>
{/if}
