<script lang="ts">
  import type { ToolEntry } from "../index";
  import { viewToolEntry } from "../logic/tool-summary";
  import LazyCollapse from "./LazyCollapse.svelte";
  import { TOOL_ICON_COMPONENTS } from "./tool-icons";

  let { entry }: { entry: ToolEntry } = $props();
  const card = $derived(viewToolEntry(entry));
  const ToolIcon = $derived(TOOL_ICON_COMPONENTS[card.icon]);
  let showAll = $state(false);
</script>

<div class="tool-card">
  <LazyCollapse label={`Toggle tool call ${card.label}`} titleClass="pe-4">
    {#snippet title()}
      <div class="tool-header" class:has-earlier-call={card.callDetail.kind === "unavailable"}>
        {#if card.status === "pending"}
          <!-- Same in-progress animation as the streaming thinking block. All three
               status icons share a fixed w-5 slot so the row never shifts on settle. -->
          <span class="loading loading-dots loading-sm w-5 shrink-0" aria-label="Running"></span>
        {:else if card.status === "error"}
          <span class="w-5 shrink-0 text-center text-error" aria-label="Failed">✗</span>
        {:else}
          <span
            class="w-5 shrink-0 text-center text-success"
            class:opacity-60={card.callDetail.kind === "unavailable"}
            aria-label="Succeeded">✓</span
          >
        {/if}
        <!-- Per-tool Phosphor icon (key chosen by the pure view-model). -->
        <ToolIcon size={16} class="shrink-0 opacity-70" aria-hidden="true" />
        <span class="tool-name truncate" title={card.name}>{card.label}</span>
        <span
          class="tool-summary truncate font-normal text-base-content/60"
          class:earlier-history={card.callDetail.kind === "unavailable"}
          title={card.callDetail.kind === "unavailable" ? card.callDetail.text : card.callSummary}
        >
          {card.callSummary}
        </span>
        <span class="tool-badges gap-1 text-xs">
          {#each card.callBadges as badge}
            <span
              class:text-success={badge.tone === "success"}
              class:text-error={badge.tone === "error"}>{badge.label}</span
            >
          {/each}
        </span>
        {#if card.resultSummary !== null}
          <span
            class="tool-result text-xs"
            class:text-error={card.status === "error"}
            title={card.resultSummary}
          >
            {#if card.resultSummary === card.compactResultSummary}
              <span>→ {card.resultSummary}</span>
            {:else}
              <span class="result-full">→ {card.resultSummary}</span>
              <span class="result-compact">→ {card.compactResultSummary}</span>
            {/if}
          </span>
        {:else}
          <span class="tool-result text-xs text-base-content/60">→ running…</span>
        {/if}
      </div>
    {/snippet}
    <div class="min-w-0 space-y-4 text-xs">
      <section aria-label="Call">
        {#if card.callDetail.kind === "unavailable"}
          <aside
            role="note"
            class="border-l-2 border-base-content/20 pl-3 italic text-base-content/60"
          >
            {card.callDetail.text}
          </aside>
        {:else}
          <h3 class="mb-2 border-b border-base-content/20 pb-1 font-semibold text-base-content">
            Call
          </h3>
        {/if}
        {#if card.callDetail.kind === "none"}
          <p class="italic text-base-content/60">No arguments</p>
        {:else if card.callDetail.kind === "command"}
          <pre class="overflow-x-auto">$ {card.callDetail.text}</pre>
        {:else if card.callDetail.kind === "edit"}
          <div class="mb-2 break-all font-mono">{card.callDetail.path}</div>
          <!-- Unified-diff style: every removed/added line carries its own −/+ gutter
               marker and a tinted row, so multi-line edits read as one diff block. -->
          <div class="edit-diff overflow-x-auto rounded font-mono" role="group" aria-label="Edit diff">
            {#if card.callDetail.oldText !== ""}
              {#each card.callDetail.oldText.split("\n") as line, i (i)}
                <div class="edit-diff-row edit-diff-del">
                  <span class="edit-diff-sign" aria-label="removed">−</span><span>{line}</span>
                </div>
              {/each}
            {/if}
            {#if card.callDetail.newText !== ""}
              {#each card.callDetail.newText.split("\n") as line, i (i)}
                <div class="edit-diff-row edit-diff-add">
                  <span class="edit-diff-sign" aria-label="added">+</span><span>{line}</span>
                </div>
              {/each}
            {/if}
          </div>
        {:else if card.callDetail.kind === "fields"}
          <dl class="call-fields">
            {#each card.callDetail.fields as field}
              <dt class="font-semibold text-base-content/85">{field.key}</dt>
              <dd class="min-w-0">
                <pre
                  class="overflow-x-auto"
                  class:whitespace-pre-wrap={!field.multiline}
                  class:break-words={!field.multiline}>{field.value}</pre>
              </dd>
            {/each}
          </dl>
        {/if}
      </section>
      <section aria-label="Response">
        <h3 class="mb-2 border-b border-base-content/20 pb-1 font-semibold text-base-content">
          Response
        </h3>
        {#if card.output === null}
          <span class="text-base-content/75">running…</span>
        {:else}
          <div class:text-error={card.output.isError}>
            {#if card.output.kind === "full"}
              <pre class="overflow-x-auto">{card.output.lines.join("\n") || "(no output)"}</pre>
            {:else}
              {#if !showAll}
                <pre class="overflow-x-auto">{card.output.head.join("\n")}</pre>
              {/if}
              <div class="output-controls" class:sticky-controls={showAll}>
                <button
                  class="btn btn-soft btn-xs focus-visible:outline-primary"
                  aria-expanded={showAll}
                  onclick={() => {
                    showAll = !showAll;
                  }}
                >
                  {#if showAll}<span aria-hidden="true">↑</span>{/if}
                  {showAll ? "Show fewer lines" : `⋯ ${card.output.hiddenCount} more lines`}
                </button>
              </div>
              {#if showAll}
                <pre class="overflow-x-auto">{card.output.all.join("\n")}</pre>
              {:else}
                <pre class="overflow-x-auto">{card.output.tail.join("\n")}</pre>
              {/if}
            {/if}
          </div>
        {/if}
      </section>
    </div>
  </LazyCollapse>
</div>

<style>
  .tool-card {
    container-type: inline-size;
  }
  .tool-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-width: 0;
  }
  /* English names are short phrases: keep them whole and let the call
     summary absorb the squeeze. The cap only bites on long MCP names. */
  .tool-name {
    flex: 0 0 auto;
    max-width: 60%;
  }
  .tool-summary {
    flex: 1;
    min-width: 0;
  }
  .earlier-history {
    font-style: italic;
    color: var(--color-base-content);
    opacity: 0.7;
  }
  .tool-badges {
    display: flex;
    flex-shrink: 0;
  }
  .tool-badges:empty {
    display: none;
  }
  .tool-result {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .result-compact {
    display: none;
  }
  .call-fields {
    display: grid;
    grid-template-columns: minmax(4rem, max-content) minmax(0, 1fr);
    gap: 0.5rem 1rem;
    align-items: baseline;
  }
  .call-fields dt {
    max-width: 10rem;
    overflow-wrap: anywhere;
  }
  .edit-diff {
    background: var(--color-base-300);
    padding-block: 0.25rem;
  }
  .edit-diff-row {
    display: flex;
    min-width: max-content;
    white-space: pre;
    padding-inline-end: 0.75rem;
  }
  .edit-diff-sign {
    flex-shrink: 0;
    width: 1.75rem;
    text-align: center;
    user-select: none;
  }
  .edit-diff-del {
    color: var(--color-error);
    background: color-mix(in oklab, var(--color-error) 12%, transparent);
  }
  .edit-diff-add {
    color: var(--color-success);
    background: color-mix(in oklab, var(--color-success) 12%, transparent);
  }
  .output-controls {
    padding-block: 0.5rem;
    color: var(--color-base-content);
    /* Same fill as the LazyCollapse inset well this sits in (opaque, so
       scrolled output never shows through the sticky bar). */
    background: var(--inset-well-bg, var(--color-base-200));
  }
  .sticky-controls {
    position: sticky;
    top: 0;
    z-index: 2;
    border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 20%, transparent);
    margin-bottom: 0.5rem;
  }
  @container (max-width: 48rem) {
    .result-full {
      display: none;
    }
    .result-compact {
      display: inline;
    }
  }
  @container (max-width: 40rem) {
    .tool-badges {
      display: none;
    }
    .has-earlier-call .tool-result {
      display: none;
    }
  }
  @container (max-width: 24rem) {
    .tool-header {
      gap: 0.375rem;
    }
    .call-fields {
      column-gap: 0.75rem;
    }
  }
  @container (max-width: 18rem) {
    .tool-result {
      display: none;
    }
  }
</style>
