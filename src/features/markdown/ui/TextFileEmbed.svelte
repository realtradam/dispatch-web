<script lang="ts">
  import { untrack } from "svelte";
  import type { MarkdownImageOptions } from "../logic/markdown";
  import { textFilePreview, type TextFileReference } from "../logic/text-file";
  import type { TextFileClient, TextFileState } from "../types";
  import MarkdownContent from "./MarkdownContent.svelte";

  let {
    reference,
    client,
    image = undefined,
  }: {
    reference: TextFileReference;
    client: TextFileClient;
    image?: MarkdownImageOptions | undefined;
  } = $props();
  let loadState = $state<TextFileState>({ kind: "loading" });
  let expanded = $state(false);
  const preview = $derived(
    loadState.kind === "ready"
      ? textFilePreview(loadState.file.text, loadState.file.format === "markdown")
      : null,
  );
  const path = $derived(reference.path);
  const currentClient = $derived(client);
  $effect(() => {
    const source = currentClient;
    const destination = path;
    expanded = false;
    // The callback can publish synchronously. Only routing changes, not reads
    // inside a subscriber or unrelated parent prop updates, own this effect.
    return untrack(() =>
      source.subscribe(destination, (next) => {
        loadState = next;
      }),
    );
  });
  // Use the resolved file's directory for local images, not the chat's cwd.
  const documentImage = $derived(
    loadState.kind === "ready" && image
      ? {
          apiBase: image.apiBase,
          cwd: loadState.file.path.slice(0, loadState.file.path.lastIndexOf("/")) || "/",
        }
      : image,
  );
</script>

<section
  class="inset-well my-2 w-full min-w-0 rounded-box text-sm"
  aria-label={`Text file: ${reference.label}`}
>
  <header class="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2 font-medium">
    <span aria-hidden="true">▤</span>
    <span>{reference.label}</span>
    <span class="min-w-0 flex-1 break-all font-mono text-xs font-normal text-base-content/60"
      >{reference.path}</span
    >
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      onclick={() => client.refresh(reference.path)}
      disabled={loadState.kind === "loading"}
    >
      {loadState.kind === "error" ? "Retry" : "Refresh"}
    </button>
  </header>
  <div class="min-w-0 px-4 pb-4">
    {#if loadState.kind === "loading"}
      <p role="status">
        <span class="loading loading-dots loading-sm" aria-hidden="true"></span> Loading text file…
      </p>
    {:else if loadState.kind === "error"}
      <p role="alert" class="text-error">{loadState.message}</p>
    {:else if loadState.file.text === ""}
      <p class="italic text-base-content/60">Empty file</p>
    {:else if preview}
      {#if expanded}
        {@render content(loadState.file.text, loadState.file.format)}
      {:else}
        {@render content(preview.head, loadState.file.format)}
        {#if preview.omitted > 0}
          <p class="my-2 border-y border-base-content/20 py-2 text-xs text-base-content/60">
            ⋯ {preview.omitted} source lines omitted ⋯
          </p>
          {@render content(preview.tail, loadState.file.format)}
        {/if}
      {/if}
      <button
        type="button"
        class="btn btn-soft btn-xs mt-2"
        aria-expanded={expanded}
        onclick={() => {
          expanded = !expanded;
        }}
      >
        {expanded ? "Collapse document" : "Expand document"}
      </button>
      <p class="mt-2 text-xs text-base-content/50">
        Live file · Refresh rereads disk · maximum 256 KiB
      </p>
    {/if}
  </div>
</section>

{#snippet content(text: string, format: "markdown" | "text")}
  {#if format === "markdown"}
    <!-- No textFiles port: nested references are inert, even in expanded content. -->
    <MarkdownContent {text} image={documentImage} />
  {:else}
    <pre class="overflow-x-auto whitespace-pre font-mono text-xs"><code>{text}</code></pre>
  {/if}
{/snippet}
