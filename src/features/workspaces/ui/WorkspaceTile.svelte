<script lang="ts">
  import type { WorkspaceEntry } from "@dispatch/wire";
  import type { WorkspaceStore } from "../store.svelte";
  import { relativeTime } from "../logic/view-model";
  import type { Placement } from "../logic/tile-layout";

  let {
    ws,
    store,
    placement,
    selected = false,
    renaming = false,
    active = false,
    onRenameEnd,
  }: {
    ws: WorkspaceEntry;
    store: WorkspaceStore;
    /** The tile's resolved footprint (already preview-adjusted by the grid). */
    placement: Placement;
    selected?: boolean;
    /** The parent-driven rename mode (the action bar's Rename action). */
    renaming?: boolean;
    /** At least one conversation in this workspace is generating/queued. */
    active?: boolean;
    /** The tile finished its rename session (saved or cancelled). */
    onRenameEnd: () => void;
  } = $props();

  // ── Title: double-click to rename inline (semantics preserved from the
  // WorkspaceCard), or enter via the action bar's Rename action (`renaming`).
  let editing = $state(false);
  let titleDraft = $state("");
  let titleInput = $state<HTMLInputElement | undefined>();
  let titleError = $state<string | null>(null);

  function startEdit(): void {
    titleDraft = ws.title;
    titleError = null;
    editing = true;
    queueMicrotask(() => titleInput?.focus());
  }

  // Seed (only) when the parent-driven rename mode turns on.
  $effect(() => {
    if (renaming) startEdit();
  });

  async function saveTitle(): Promise<void> {
    if (!editing) return;
    const title = titleDraft.trim();
    editing = false;
    onRenameEnd();
    if (title === "" || title === ws.title) return;
    const result = await store.rename(ws.id, title);
    if (!result.ok) titleError = result.error;
  }

  function cancelTitle(): void {
    editing = false;
    titleError = null;
    onRenameEnd();
  }

  // The face's semantic key (tests read it).
  const faceKey = $derived(`tile-${placement.id}`);

  // Span-aware face: bigger footprints get more air + bigger type (all styles
  // static so Tailwind sees them).
  const wide = $derived(placement.colSpan > 1);
  const tall = $derived(placement.rowSpan > 1);
  const facePadding = $derived(wide || tall ? "p-5" : "p-4");
  const titleClass = $derived(
    wide && tall
      ? "text-3xl leading-tight line-clamp-3"
      : wide
        ? "text-2xl leading-snug line-clamp-2"
        : tall
          ? "text-xl leading-snug line-clamp-4"
          : "text-lg leading-snug line-clamp-3",
  );
  /** 1×1 tiles are tight: "20 conv." — wider tiles spell "conversations" out. */
  const countLabel = $derived(
    ws.conversationCount === 1 ? (wide ? "conversation" : "conv.") : wide ? "conversations" : "conv.",
  );
</script>

<div data-tile-face={faceKey} class={`relative flex h-full w-full flex-col ${facePadding}`}>
  <!-- The slug label at the very top — the Win8 tile's small "app" caption. -->
  <div class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
    <span class="truncate opacity-70">/{ws.id}</span>
    {#if active}
      <span
        class="loading loading-dots loading-xs shrink-0"
        aria-label="Workspace has active conversations"
        title="A conversation in this workspace is generating"></span>
    {/if}
  </div>

  {#if ws.starred}
    <!-- Starred is a badge, not a tint — the tone stays the tile's identity. -->
    <span
      class="absolute top-2.5 right-3 text-lg leading-none opacity-90"
      aria-label="Starred workspace"
      title="Starred — priority in the agent queue">★</span
    >
  {/if}

  {#if editing}
    <input
      bind:this={titleInput}
      bind:value={titleDraft}
      class="input input-sm mt-2 w-full border-current/40 bg-black/25 text-inherit placeholder:text-current/50"
      aria-label="Workspace title"
      onkeydown={(e) => {
        if (e.key === "Enter") void saveTitle();
        else if (e.key === "Escape") cancelTitle();
      }}
      onblur={() => void saveTitle()}
    />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <span
      class={`mt-1 cursor-default font-bold ${titleClass}`}
      title="Double-click to rename"
      ondblclick={startEdit}>{ws.title}</span
    >
  {/if}

  {#if titleError}
    <p class="mt-1 text-xs font-semibold">{titleError}</p>
  {/if}

  <!-- The stat line pinned to the tile's bottom edge, like a live tile's
       status row. Single-line, truncation-safe (narrow 1×1 tiles stay clean). -->
  <div
    class="mt-auto flex items-center gap-2 overflow-hidden border-t border-current/20 pt-2 text-xs font-medium whitespace-nowrap"
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" class="shrink-0 opacity-70">◱</span>
      <span class="truncate">
        {ws.conversationCount}
        {countLabel}
      </span>
    </span>
    <span class="ml-auto shrink-0 font-mono opacity-70">
      {relativeTime(ws.lastActivityAt, Date.now())}
    </span>
  </div>
</div>
