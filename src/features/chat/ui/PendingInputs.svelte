<script lang="ts">
  import type { PendingInput } from "../pending-inputs";
  import PendingInputWarning from "./PendingInputWarning.svelte";

  let {
    inputs,
    onDiscard,
  }: {
    inputs: readonly PendingInput[];
    onDiscard: (requestId: string) => void;
  } = $props();
</script>

{#each inputs as input (input.request.requestId)}
  <PendingInputWarning {input} {onDiscard} />
{/each}
