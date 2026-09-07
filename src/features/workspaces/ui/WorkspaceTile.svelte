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
</script>

<div data-tile-face={faceKey} class="flex h-full w-full flex-col gap-1 p-3">
  {#if editing}
    <input
      bind:this={titleInput}
      bind:value={titleDraft}
      class="input input-bordered input-sm"
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
      class="line-clamp-2 cursor-default text-lg leading-tight font-bold"
      title="Double-click to rename"
      ondblclick={startEdit}>{ws.title}</span
    >
  {/if}

  <span class="font-mono text-xs opacity-50">/{ws.id}</span>

  {#if titleError}
    <p class="text-xs text-error">{titleError}</p>
  {/if}

  <div class="mt-auto flex items-center gap-2 text-xs opacity-80">
    {#if active}
      <span
        class="loading loading-dots loading-xs shrink-0 text-primary"
        aria-label="Workspace has active conversations"
        title="A conversation in this workspace is generating"></span>
    {/if}
    <span>
      {ws.conversationCount}
      {ws.conversationCount === 1 ? "conversation" : "conversations"}
    </span>
    <span class="ml-auto font-mono opacity-70">{relativeTime(ws.lastActivityAt, Date.now())}</span>
  </div>
</div>
