<script lang="ts">
  import type { ComputerEntry, WorkspaceEntry } from "@dispatch/wire";
  import { untrack } from "svelte";
  import type { WorkspaceStore } from "../store.svelte";
  import { relativeTime } from "../logic/view-model";
  import { workspacePath } from "../logic/route";
  import ComputerSelect from "../../computer/ui/ComputerSelect.svelte";

  let {
    ws,
    store,
    onNavigate,
    computers,
  }: {
    ws: WorkspaceEntry;
    store: WorkspaceStore;
    onNavigate: (path: string) => void;
    /** Discovered computers (`GET /computers`), for the default-computer dropdown. */
    computers: readonly ComputerEntry[];
  } = $props();

  // ── Title: double-click to rename inline ──────────────────────────────────
  let editingTitle = $state(false);
  let titleDraft = $state("");
  let titleInput = $state<HTMLInputElement | undefined>();
  let titleError = $state<string | null>(null);

  function startEditTitle(): void {
    titleDraft = ws.title;
    titleError = null;
    editingTitle = true;
    queueMicrotask(() => titleInput?.focus());
  }

  async function saveTitle(): Promise<void> {
    if (!editingTitle) return;
    const title = titleDraft.trim();
    editingTitle = false;
    if (title === "" || title === ws.title) return;
    const result = await store.rename(ws.id, title);
    if (!result.ok) titleError = result.error;
  }

  function cancelTitle(): void {
    editingTitle = false;
    titleError = null;
  }

  // ── Default cwd: inline input ─────────────────────────────────────────────
  let cwdDraft = $state(untrack(() => ws.defaultCwd ?? ""));
  // Reseed when the backend value changes (e.g., after a save or an external
  // refresh). Mid-edit (same value) does NOT re-run, so typing is never clobbered.
  $effect(() => {
    cwdDraft = ws.defaultCwd ?? "";
  });

  const cwdDirty = $derived(cwdDraft.trim() !== (ws.defaultCwd ?? ""));
  let savingCwd = $state(false);
  let cwdError = $state<string | null>(null);

  async function saveCwd(): Promise<void> {
    if (!cwdDirty || savingCwd) return;
    savingCwd = true;
    cwdError = null;
    const cwd = cwdDraft.trim();
    const result = await store.setDefaultCwd(ws.id, cwd === "" ? null : cwd);
    savingCwd = false;
    if (!result.ok) cwdError = result.error;
  }

  // ── Default computer: dropdown (Local / discovered SSH aliases) ────────────
  let savingComputer = $state(false);
  let computerError = $state<string | null>(null);

  async function saveComputer(computerId: string | null): Promise<void> {
    if (savingComputer) return;
    // No-op when unchanged (the select only fires on a real change, but guard).
    if (computerId === (ws.defaultComputerId ?? null)) return;
    savingComputer = true;
    computerError = null;
    const result = await store.setDefaultComputer(ws.id, computerId);
    savingComputer = false;
    if (!result.ok) computerError = result.error;
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  let deleting = $state(false);

  async function handleDelete(): Promise<void> {
    if (
      !window.confirm(
        `Delete workspace "${ws.title}"? Its conversations will be closed and moved to "default".`,
      )
    ) {
      return;
    }
    deleting = true;
    await store.remove(ws.id);
    deleting = false;
  }
</script>

<li class="flex flex-col gap-2 rounded-box border border-primary bg-primary/10 p-3">
  <div class="flex items-center gap-2">
    {#if editingTitle}
      <input
        bind:this={titleInput}
        bind:value={titleDraft}
        class="input input-bordered input-sm flex-1"
        aria-label="Workspace title"
        onkeydown={(e) => {
          if (e.key === "Enter") saveTitle();
          else if (e.key === "Escape") cancelTitle();
        }}
        onblur={saveTitle}
      />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
      <span
        class="flex-1 cursor-default truncate font-semibold"
        title="Double-click to rename"
        ondblclick={startEditTitle}>{ws.title}</span
      >
    {/if}
    <span class="font-mono text-xs opacity-50">/{ws.id}</span>
    <span class="ml-auto text-xs opacity-50">
      {ws.conversationCount}
      {ws.conversationCount === 1 ? "conversation" : "conversations"}
      · {relativeTime(ws.lastActivityAt, Date.now())}
    </span>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={deleting}
      title="Delete workspace"
      aria-label="Delete workspace"
      onclick={handleDelete}
    >
      {#if deleting}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        ✕
      {/if}
    </button>
  </div>

  {#if titleError}
    <p class="text-xs text-error">{titleError}</p>
  {/if}

  <div class="flex items-center gap-2">
    <span class="w-8 shrink-0 text-xs opacity-60">cwd</span>
    <input
      type="text"
      class="input input-bordered input-sm flex-1 font-mono text-xs"
      placeholder="inherits the server default"
      bind:value={cwdDraft}
      aria-label="Default working directory"
      onkeydown={(e) => {
        if (e.key === "Enter") saveCwd();
      }}
    />
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={!cwdDirty || savingCwd}
      onclick={saveCwd}
    >
      {#if savingCwd}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        Set
      {/if}
    </button>
  </div>

  <div class="flex items-center gap-2">
    <span class="w-8 shrink-0 text-xs opacity-60">ssh</span>
    <ComputerSelect
      value={ws.defaultComputerId}
      {computers}
      disabled={savingComputer}
      onSelect={saveComputer}
    />
    {#if savingComputer}
      <span class="loading loading-spinner loading-xs shrink-0"></span>
    {/if}
  </div>

  <div class="flex justify-start">
    <a class="btn" href={workspacePath(ws.id)} target="_blank" rel="noopener noreferrer"> Open </a>
  </div>

  {#if cwdError}
    <p class="text-xs text-error">{cwdError}</p>
  {:else if !cwdDirty && !ws.defaultCwd}
    <p class="text-xs opacity-50">No default cwd set — conversations inherit the server default.</p>
  {/if}

  {#if computerError}
    <p class="text-xs text-error">{computerError}</p>
  {:else if !ws.defaultComputerId}
    <p class="text-xs opacity-50">No default computer — conversations run locally (no SSH).</p>
  {/if}
</li>
