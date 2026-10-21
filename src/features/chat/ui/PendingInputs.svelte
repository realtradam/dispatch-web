<script lang="ts">
  import type { PendingInput } from "../pending-inputs";

  let {
    inputs,
    onDiscard,
  }: {
    inputs: readonly PendingInput[];
    onDiscard: (requestId: string) => void;
  } = $props();
</script>

{#each inputs as input (input.request.requestId)}
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
{/each}
