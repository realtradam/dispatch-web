<script lang="ts">
  import { onMount } from "svelte";
  import type { PendingInput } from "../pending-inputs";

  let {
    input,
    onDiscard,
  }: {
    input: PendingInput;
    onDiscard: (requestId: string) => void;
  } = $props();

  let visible = $state(false);

  // Presentation only: each keyed row gets one grace period, including restored
  // or rejected inputs. Prop updates never restart it. Confirmation/discard
  // removes the row, cancelling the timer along with any other unmount.
  onMount(() => {
    const timer = setTimeout(() => {
      visible = true;
    }, 1000);
    return () => clearTimeout(timer);
  });
</script>

{#if visible}
  <div class="m-3 rounded border border-warning p-3 text-sm" role="status">
    <p>
      {input.rejection
        ? `Message rejected: ${input.rejection}`
        : "Delivery unconfirmed. Your input is saved on this device."}
    </p>
    <p>Check the conversation history before sending again to avoid a duplicate.</p>
    <textarea
      class="textarea textarea-bordered mt-2 w-full"
      aria-label="Saved message"
      readonly
      value={input.request.type === "chat.send" ? input.request.message : input.request.text}
    ></textarea>
    {#each input.request.images ?? [] as image}
      <img class="my-2 max-h-32" src={image.url} alt="Saved attachment" />
    {/each}
    <button class="btn btn-sm mt-2" onclick={() => onDiscard(input.request.requestId)}
      >Discard saved copy</button
    >
  </div>
{/if}
