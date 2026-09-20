<script lang="ts">
  import type { WorkspaceEntry } from "@dispatch/wire";
  import type { WorkspaceStore } from "../store.svelte";
  import { relativeTime } from "../logic/view-model";

  let {
    store,
    onOpen,
    onClose,
  }: {
    store: WorkspaceStore;
    /** Open (view) a workspace — navigates to `/<id>`. */
    onOpen: (id: string) => void;
    onClose: () => void;
  } = $props();

  // Load the archived list when the modal mounts.
  $effect(() => {
    void store.refreshArchived();
  });

  let busyId = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  async function unarchive(ws: WorkspaceEntry): Promise<void> {
    if (busyId !== null) return;
    busyId = ws.id;
    actionError = null;
    const result = await store.setArchived(ws.id, false);
    busyId = null;
    if (!result.ok) {
      actionError = result.error;
      return;
    }
    // Refresh the archived list so the unarchived workspace leaves it.
    void store.refreshArchived();
  }

  function open(ws: WorkspaceEntry): void {
    onOpen(ws.id);
    onClose();
  }
</script>

<div class="modal modal-open" role="dialog" aria-label="Archived workspaces">
  <div class="modal-box max-w-lg">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h2 class="text-lg font-bold">Archived workspaces</h2>
        <p class="text-xs opacity-50">Hidden from the home grid. Unarchive to restore.</p>
      </div>
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        aria-label="Close archived workspaces"
        onclick={onClose}>✕</button
      >
    </div>

    {#if actionError}
      <p class="mt-3 text-xs text-error">{actionError}</p>
    {/if}

    <div class="mt-4">
      {#if store.archivedLoading && store.archivedList.length === 0}
        <div class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md opacity-60"></span>
        </div>
      {:else if store.archivedList.length === 0}
        <p class="py-8 text-center text-sm opacity-50">No archived workspaces.</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each store.archivedList as ws (ws.id)}
            <li
              class="flex items-center justify-between gap-3 rounded-box border border-base-content/10 bg-base-200/40 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold">{ws.title}</p>
                <p class="font-mono text-xs opacity-50">
                  /{ws.id} · {ws.conversationCount} conv · {relativeTime(
                    ws.lastActivityAt,
                    Date.now(),
                  )} ago
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  onclick={() => open(ws)}
                  aria-label={`Open ${ws.title}`}>View</button
                >
                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  disabled={busyId === ws.id}
                  onclick={() => void unarchive(ws)}
                  aria-label={`Unarchive ${ws.title}`}
                >
                  {#if busyId === ws.id}
                    <span class="loading loading-spinner loading-xs"></span>
                  {:else}
                    Unarchive
                  {/if}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
  <!-- Click outside closes. -->
  <button
    type="button"
    class="modal-backdrop"
    aria-label="Close archived workspaces backdrop"
    onclick={onClose}></button>
</div>
