<script lang="ts">
  import { untrack } from "svelte";
  import type { ComputerEntry, WorkspaceEntry } from "@dispatch/wire";
  import type { WorkspaceStore } from "../store.svelte";
  import ComputerSelect from "../../computer/ui/ComputerSelect.svelte";

  let {
    ws,
    store,
    computers,
    onClose,
  }: {
    ws: WorkspaceEntry;
    store: WorkspaceStore;
    /** Discovered computers (`GET /computers`), for the default-computer dropdown. */
    computers: readonly ComputerEntry[];
    onClose: () => void;
  } = $props();

  // ── Default cwd: input + Set (semantics preserved from the WorkspaceCard) ──
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
</script>

<div class="modal modal-open" role="dialog" aria-label={`Workspace details: ${ws.title}`}>
  <div class="modal-box">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h2 class="text-lg font-bold">{ws.title}</h2>
        <p class="font-mono text-xs opacity-50">/{ws.id}</p>
      </div>
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        aria-label="Close details"
        onclick={onClose}>✕</button
      >
    </div>

    <div class="mt-4 flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <span class="w-8 shrink-0 text-xs opacity-60">cwd</span>
        <input
          type="text"
          class="input input-bordered input-sm flex-1 font-mono text-xs"
          placeholder="inherits the server default"
          bind:value={cwdDraft}
          aria-label="Default working directory"
          onkeydown={(e) => {
            if (e.key === "Enter") void saveCwd();
          }}
        />
        <button
          type="button"
          class="btn btn-primary btn-xs"
          disabled={!cwdDirty || savingCwd}
          onclick={() => void saveCwd()}
        >
          {#if savingCwd}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            Set
          {/if}
        </button>
      </div>

      {#if cwdError}
        <p class="text-xs text-error">{cwdError}</p>
      {:else if !cwdDirty && !ws.defaultCwd}
        <p class="text-xs opacity-50">No default cwd set — conversations inherit the server default.</p>
      {/if}

      <div class="flex items-center gap-2">
        <span class="w-8 shrink-0 text-xs opacity-60">ssh</span>
        <ComputerSelect
          value={ws.defaultComputerId}
          {computers}
          disabled={savingComputer}
          onSelect={(id) => void saveComputer(id)}
        />
        {#if savingComputer}
          <span class="loading loading-spinner loading-xs shrink-0"></span>
        {/if}
      </div>

      {#if computerError}
        <p class="text-xs text-error">{computerError}</p>
      {:else if !ws.defaultComputerId}
        <p class="text-xs opacity-50">No default computer — conversations run locally (no SSH).</p>
      {/if}
    </div>
  </div>
  <!-- Click outside closes. -->
  <button
    type="button"
    class="modal-backdrop"
    aria-label="Close details backdrop"
    onclick={onClose}></button>
</div>
