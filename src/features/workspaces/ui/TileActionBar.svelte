<script lang="ts">
  import { fly } from "svelte/transition";
  import type { WorkspaceEntry } from "@dispatch/wire";

  let {
    ws,
    withPlugins = false,
    onOpen,
    onRename,
    onResize,
    onToggleStar,
    onDetails,
    onPlugins,
    onArchive,
    onDelete,
    onClose,
  }: {
    ws: WorkspaceEntry;
    /** The plugins port is present → the Plugins action renders. */
    withPlugins?: boolean;
    onOpen: () => void;
    onRename: () => void;
    onResize: () => void;
    onToggleStar: () => void;
    /** The details flyout (default cwd + default computer). */
    onDetails: () => void;
    onPlugins: () => void;
    /** Archive the workspace (hide from the home grid; reversible). */
    onArchive: () => void;
    onDelete: () => void;
    onClose: () => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
  class="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4"
  transition:fly={{ y: 80, duration: 150 }}
  onclick={(e) => {
    // The bar owns its clicks — don't let them deselect via the backdrop.
    e.stopPropagation();
  }}
>
  <div
    class="flex flex-wrap items-center justify-center gap-1 rounded-box border border-base-content/15 bg-base-100 p-2 shadow-2xl"
    role="toolbar"
    aria-label={`Actions for ${ws.title}`}
  >
    <button type="button" class="btn btn-primary btn-sm" onclick={onOpen}>Open</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick={onRename}>Rename</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick={onResize}>Resize</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick={onDetails}>Details</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick={onToggleStar}>
      {ws.starred ? "Unstar" : "Star"}
    </button>
    {#if withPlugins}
      <button type="button" class="btn btn-ghost btn-sm" onclick={onPlugins}>Plugins</button>
    {/if}
    <button type="button" class="btn btn-ghost btn-sm" onclick={onArchive}>Archive</button>
    <button
      type="button"
      class="btn btn-ghost btn-sm text-error"
      onclick={onDelete}>Delete</button
    >
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-sm"
      aria-label="Close actions"
      title="Close"
      onclick={onClose}>✕</button
    >
  </div>
</div>
