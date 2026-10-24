<script lang="ts">
  import type { MarkdownImageOptions } from "../logic/markdown";
  import { splitTextFiles } from "../logic/text-file";
  import type { TextFileClient } from "../types";
  import MarkdownContent from "./MarkdownContent.svelte";
  import TextFileEmbed from "./TextFileEmbed.svelte";

  let {
    text,
    streaming = false,
    image = undefined,
    textFiles = undefined,
  }: {
    text: string;
    streaming?: boolean;
    image?: MarkdownImageOptions | undefined;
    /** Explicit opt-in; embedded documents never receive this port. */
    textFiles?: TextFileClient | undefined;
  } = $props();
  const parts = $derived(textFiles ? splitTextFiles(text, streaming) : null);
</script>

{#if parts && textFiles}
  {#each parts as part, i (i)}
    {#if part.kind === "text-file"}
      <TextFileEmbed reference={part.reference} client={textFiles} {image} />
    {:else}
      <MarkdownContent text={part.text} {streaming} {image} />
    {/if}
  {/each}
{:else}
  <MarkdownContent {text} {streaming} {image} />
{/if}
