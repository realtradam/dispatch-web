<script lang="ts">
  import { isValidSlug } from "../logic/route";

  /** The create outcome the page reports back to the popover. */
  export type CreateResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

  let {
    compact = false,
    withPlugins = false,
    withSort = false,
    onCreate,
    onOpenPlugins,
    onSort,
  }: {
    /** Tall geometry: the controls collapse to compact icon buttons and the
     * new-workspace popover becomes a bottom sheet. */
    compact?: boolean;
    /** The plugins port is present → the Plugins button renders. */
    withPlugins?: boolean;
    /** The Sort overflow action renders (recent-activity re-apply). */
    withSort?: boolean;
    /** Create the workspace on the backend (does NOT navigate); the page
     * places the new tile + enters rename mode. */
    onCreate: (slug: string) => Promise<CreateResult>;
    onOpenPlugins: () => void;
    onSort: () => void;
  } = $props();

  // ── New workspace popover (today's inline form logic, preserved) ──────────
  let newSlug = $state("");
  let slugError = $state<string | null>(null);
  let popoverOpen = $state(false);
  let submitting = $state(false);
  let slugInput = $state<HTMLInputElement | undefined>();

  const slugValid = $derived(newSlug.length > 0 && isValidSlug(newSlug));

  function openPopover(): void {
    popoverOpen = true;
    slugError = null;
    queueMicrotask(() => slugInput?.focus());
  }

  function closePopover(): void {
    popoverOpen = false;
    newSlug = "";
    slugError = null;
  }

  async function submit(): Promise<void> {
    const slug = newSlug.trim();
    if (!isValidSlug(slug)) {
      slugError = "Lowercase letters, digits, and hyphens (1–40 chars).";
      return;
    }
    slugError = null;
    submitting = true;
    const result = await onCreate(slug);
    submitting = false;
    if (!result.ok) {
      slugError = result.error;
      return;
    }
    closePopover();
  }
</script>

<header class="flex shrink-0 items-end justify-between gap-2 px-8 pt-6 pb-4 md:px-12">
  <div class="flex items-baseline gap-3">
    <h1 class="text-4xl font-black tracking-tight">Dispatch</h1>
    <span class="hidden text-sm font-medium tracking-widest uppercase opacity-40 sm:inline">
      Workspaces
    </span>
  </div>

  <div class="flex items-center gap-2" class:gap-1={compact}>
    <!-- New workspace -->
    <button
      type="button"
      class="btn btn-primary btn-sm"
      class:btn-circle={compact}
      aria-label="New workspace"
      title="New workspace"
      onclick={() => (popoverOpen ? closePopover() : openPopover())}
    >
      {#if compact}
        <span aria-hidden="true" class="text-lg leading-none">+</span>
      {:else}
        New workspace
      {/if}
    </button>

    {#if withPlugins}
      <button
        type="button"
        class="btn btn-outline btn-sm"
        class:btn-circle={compact}
        aria-label="Plugins"
        title="Open the plugin manager (load/unload plugins globally)"
        onclick={onOpenPlugins}
      >
        {#if compact}
          <span aria-hidden="true">⚡</span>
        {:else}
          Plugins
        {/if}
      </button>
    {/if}

    {#if withSort}
      <div class="dropdown dropdown-end">
        <button type="button" class="btn btn-ghost btn-sm" aria-label="More actions" title="More">
          ⋯
        </button>
        <ul class="dropdown-content menu z-50 w-52 rounded-box border border-base-content/15 bg-base-100 p-2 shadow-xl">
          <li>
            <button type="button" onclick={onSort}>Reset arrangement by recent activity</button>
          </li>
        </ul>
      </div>
    {/if}
  </div>
</header>

{#if popoverOpen}
  <!-- Backdrop closes the popover. -->
  <button
    type="button"
    class="fixed inset-0 z-40 cursor-default"
    aria-label="Close new workspace"
    onclick={closePopover}></button>

  <!-- One popover body; the geometry only changes its positioning (bottom
       sheet on tall screens, a corner card on wide ones). -->
  <div
    class="fixed z-50 border border-base-content/15 bg-base-100 p-4 shadow-2xl"
    class:inset-x-0={compact}
    class:bottom-0={compact}
    class:rounded-t-box={compact}
    class:top-14={!compact}
    class:right-6={!compact}
    class:w-80={!compact}
    class:rounded-box={!compact}
  >
    <form
      class="flex flex-col gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label for="new-ws" class="text-xs font-semibold uppercase opacity-60">New workspace</label>
      <input
        id="new-ws"
        bind:this={slugInput}
        class="input input-bordered w-full"
        placeholder="my-workspace"
        bind:value={newSlug}
        autocomplete="off"
        spellcheck="false"
      />
      {#if slugError}<p class="text-xs text-error">{slugError}</p>{/if}
      <div class="flex justify-end gap-2">
        {#if compact}
          <button type="button" class="btn btn-ghost btn-sm" onclick={closePopover}>Cancel</button>
        {/if}
        <button type="submit" class="btn btn-primary btn-sm" disabled={!slugValid || submitting}>
          {#if submitting}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Create
        </button>
      </div>
    </form>
  </div>
{/if}
