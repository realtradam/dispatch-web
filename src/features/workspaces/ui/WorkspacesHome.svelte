<script lang="ts">
  import { onMount } from "svelte";
  import type { ComputerEntry } from "@dispatch/wire";
  import { PluginManager, type PluginsStore } from "../../plugins";
  import type { WorkspaceStore } from "../store.svelte";
  import { isValidSlug, workspacePath } from "../logic/route";
  import WorkspaceCard from "./WorkspaceCard.svelte";

  let {
    store,
    onNavigate,
    computers,
    hasActive,
    plugins,
  }: {
    store: WorkspaceStore;
    onNavigate: (path: string) => void;
    computers: readonly ComputerEntry[];
    /**
     * Optional port forwarded to each {@link WorkspaceCard}: whether the
     * workspace has at least one active (generating / queued) conversation.
     * Wired by the composition root to the app store. Absent → no indicator.
     */
    hasActive?: (workspaceId: string) => boolean;
    /**
     * The plugin manager store (plan 07): drives the page-header global
     * "Plugins" button + the per-card workspace modals (forwarded to
     * {@link WorkspaceCard}). Optional (absent in tests that don't exercise
     * plugins) → the buttons don't render.
     */
    plugins?: PluginsStore;
  } = $props();

  onMount(() => {
    void store.refresh();
  });

  let newSlug = $state("");
  let slugError = $state<string | null>(null);

  const slugValid = $derived(newSlug.length > 0 && isValidSlug(newSlug));

  // Global plugin manager modal (plan 07 §7.2): opened from the header
  // button; the ONLY surface that loads/unloads code (strict layering).
  let managerOpen = $state(false);

  function createWorkspace(): void {
    const slug = newSlug.trim();
    if (!isValidSlug(slug)) {
      slugError = "Lowercase letters, digits, and hyphens (1–40 chars).";
      return;
    }
    slugError = null;
    newSlug = "";
    onNavigate(workspacePath(slug));
  }
</script>

<div class="mx-auto flex h-screen w-full max-w-3xl flex-col gap-4 p-6">
  <header class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Workspaces</h1>
    <div class="flex items-center gap-2">
      <a
        href="/default"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.preventDefault();
          onNavigate("/default");
        }}
      >
        Default
      </a>
      {#if plugins}
        <button
          type="button"
          class="btn btn-outline btn-sm"
          onclick={() => (managerOpen = true)}
          title="Open the plugin manager (load/unload plugins globally)"
        >
          Plugins
        </button>
      {/if}
    </div>
  </header>

  <form
    class="flex items-end gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      createWorkspace();
    }}
  >
    <div class="flex-1">
      <label for="new-ws" class="mb-1 block text-xs font-semibold uppercase opacity-60"
        >New workspace</label
      >
      <input
        id="new-ws"
        class="input input-bordered w-full"
        placeholder="my-workspace"
        bind:value={newSlug}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <button type="submit" class="btn btn-primary btn-sm" disabled={!slugValid}>Create</button>
  </form>
  {#if slugError}
    <p class="text-xs text-error">{slugError}</p>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if store.loading && store.list.length === 0}
      <div class="flex h-32 items-center justify-center">
        <span class="loading loading-spinner loading-sm opacity-60"></span>
      </div>
    {:else if store.list.length === 0}
      <p class="py-8 text-center text-sm opacity-60">
        No workspaces yet. Create one above or visit <code>/your-name</code> in the URL.
      </p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each store.list as ws (ws.id)}
          <WorkspaceCard
            {ws}
            {store}
            {onNavigate}
            {computers}
            {...(hasActive ? { hasActive } : {})}
            {...(plugins ? { plugins } : {})}
          />
        {/each}
      </ul>
    {/if}
  </div>
</div>

{#if managerOpen && plugins}
  <PluginManager {plugins} onClose={() => (managerOpen = false)} />
{/if}
