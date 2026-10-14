<script lang="ts">
  import type { ToolEntry } from "../index";
  import { viewToolEntry } from "../logic/tool-summary";
  import LazyCollapse from "./LazyCollapse.svelte";

  let { entry }: { entry: ToolEntry } = $props();
  const card = $derived(viewToolEntry(entry));
  let showAll = $state(false);
</script>

<LazyCollapse label={`Toggle tool call ${card.name}`}>
  {#snippet title()}
    {#if card.status === "pending"}
      <span class="loading loading-spinner loading-xs shrink-0" aria-label="Running"></span>
    {:else if card.status === "error"}
      <span class="shrink-0 text-error" aria-label="Failed">✗</span>
    {:else}
      <span class="shrink-0 text-success" aria-label="Succeeded">✓</span>
    {/if}
    <svg
      class="h-4 w-4 shrink-0 opacity-60"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
      />
    </svg>
    <span class="max-w-[35%] shrink-0 truncate" title={card.name}>{card.name}</span>
    <span class="min-w-0 flex-1 truncate opacity-70" title={card.callSummary}
      >{card.callSummary}</span
    >
    {#each card.callBadges as badge}
      <span class="shrink-0 text-xs opacity-70">{badge}</span>
    {/each}
    {#if card.resultSummary !== null}
      <span
        class="max-w-[40%] shrink-0 truncate text-xs"
        class:text-error={card.status === "error"}
        title={card.resultSummary}
      >
        → {card.resultSummary}
      </span>
    {/if}
  {/snippet}
  <div class="min-w-0 space-y-3 text-xs">
    <section aria-label="Call">
      <div class="mb-1 font-medium opacity-60">Call</div>
      {#if card.callDetail.kind === "command"}
        <pre class="overflow-x-auto">$ {card.callDetail.text}</pre>
      {:else if card.callDetail.kind === "edit"}
        <div class="mb-1 break-all font-mono">{card.callDetail.path}</div>
        <div class="space-y-1">
          <div class="opacity-60">− old</div>
          <pre class="overflow-x-auto text-error">{card.callDetail.oldText}</pre>
          <div class="opacity-60">+ new</div>
          <pre class="overflow-x-auto text-success">{card.callDetail.newText}</pre>
        </div>
      {:else}
        <dl class="space-y-1">
          {#each card.callDetail.fields as field}
            <div>
              <dt class="opacity-60">{field.key}</dt>
              <dd>
                <pre
                  class="overflow-x-auto"
                  class:whitespace-pre-wrap={!field.multiline}>{field.value}</pre>
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
    </section>
    <section aria-label="Response">
      <div class="mb-1 font-medium opacity-60">Response</div>
      {#if card.output === null}
        <span class="opacity-60">running…</span>
      {:else}
        <div class:text-error={card.output.isError}>
          {#if card.output.kind === "full"}
            <pre class="overflow-x-auto">{card.output.lines.join("\n") || "(no output)"}</pre>
          {:else}
            {#if showAll}
              <pre class="overflow-x-auto">{card.output.all.join("\n")}</pre>
            {:else}
              <pre class="overflow-x-auto">{card.output.head.join("\n")}</pre>
            {/if}
            <button
              class="btn btn-ghost btn-xs my-1"
              aria-expanded={showAll}
              onclick={() => {
                showAll = !showAll;
              }}
            >
              {showAll ? "Show fewer lines" : `⋯ ${card.output.hiddenCount} more lines`}
            </button>
            {#if !showAll}
              <pre class="overflow-x-auto">{card.output.tail.join("\n")}</pre>
            {/if}
          {/if}
        </div>
      {/if}
    </section>
  </div>
</LazyCollapse>
