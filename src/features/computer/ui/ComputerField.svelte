<script lang="ts">
  import type { ComputerStatusResponse } from "@dispatch/transport-contract";
  import ComputerSelect from "./ComputerSelect.svelte";
  import {
    viewComputerStatus,
    type ComputerStatusView,
    type LoadComputerStatus,
    type SaveComputer,
    type TestComputer,
  } from "../logic/view-model";
  import type { ComputerEntry } from "@dispatch/wire";
  import { untrack } from "svelte";

  let {
    computerId,
    canEdit,
    computers,
    save,
    loadStatus,
    test,
  }: {
    /** The active conversation's persisted computer alias, or null (local/inherit). */
    computerId: string | null;
    /** Whether a real conversation is focused (a draft can't persist yet). */
    canEdit: boolean;
    /** Discovered computers from `GET /computers` (read-only). */
    computers: readonly ComputerEntry[];
    save: SaveComputer;
    loadStatus: LoadComputerStatus;
    test: TestComputer;
  } = $props();

  // ── Save: selecting a dropdown option persists immediately (PUT /computer). ──
  let saving = $state(false);
  let error = $state<string | null>(null);
  let justSaved = $state(false);

  async function select(computerId: string | null) {
    if (saving || !canEdit) return;
    saving = true;
    error = null;
    justSaved = false;
    const result = await save(computerId);
    saving = false;
    if (result === null) return;
    if (result.ok) {
      justSaved = true;
    } else {
      error = result.error;
    }
  }

  // ── Connection status: poll the selected computer's live state. Owned + ──
  //    disposed here (never leaks across conversations — the field re-mounts per
  //    conversation via the {#key} in App.svelte, like CwdField). No poll while
  //    local (no alias) or while a draft can't persist.
  let statusView = $state<ComputerStatusView | null>(null);
  let statusError = $state<string | null>(null);

  async function refreshStatus() {
    const alias = untrack(() => computerId);
    if (alias === null) {
      statusView = null;
      statusError = null;
      return;
    }
    const result = await loadStatus(alias);
    if (result === null) return;
    if (result.ok) {
      statusView = viewComputerStatus(result.status);
      statusError = null;
    } else {
      statusView = null;
      statusError = result.error;
    }
  }

  // Re-fetch on mount + whenever the selected alias changes (incl. after a save).
  // Clear the test result so a stale ✓ from alias A doesn't persist for alias B.
  $effect(() => {
    void computerId;
    testResult = null;
    void refreshStatus();
  });

  // Poll the status while a computer is selected. `connecting` is transient, so
  // a faster cadence helps it flip to `connected`; a connected host is stable.
  const POLL_MS = 4000;
  $effect(() => {
    const alias = computerId;
    if (alias === null) return;
    const handle = setInterval(() => void refreshStatus(), POLL_MS);
    return () => clearInterval(handle);
  });

  // ── Test connection: one-shot probe (POST /computers/:alias/test). ──────────
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; error: string | null } | null>(null);

  async function runTest() {
    const alias = untrack(() => computerId);
    if (alias === null || testing) return;
    testing = true;
    testResult = null;
    const result = await test(alias);
    testing = false;
    if (result === null) return;
    testResult = result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
    // Refresh the connection-status badge so it reflects the post-test state
    // (clears a stale "connecting" spinner caught by the poll mid-test).
    void refreshStatus();
  }

  const badgeClass = $derived.by(() => {
    const b = statusView?.badge ?? "neutral";
    switch (b) {
      case "success":
        return "badge-success";
      case "warning":
        return "badge-warning";
      case "error":
        return "badge-error";
      default:
        return "badge-ghost";
    }
  });
</script>

<div class="flex flex-col gap-1">
  <span class="text-xs font-semibold uppercase opacity-60">Computer (SSH)</span>
  <div class="flex items-center gap-2">
    <ComputerSelect
      value={computerId}
      {computers}
      disabled={!canEdit || saving}
      onSelect={select}
    />
    {#if saving}
      <span class="loading loading-spinner loading-xs shrink-0"></span>
    {/if}
  </div>

  {#if !canEdit}
    <p class="text-xs opacity-60">Start or open a conversation to set its computer.</p>
  {:else if computerId !== null}
    <!-- Connection status badge + Test affordance for the selected computer. -->
    <div class="flex flex-wrap items-center gap-2">
      {#if statusView}
        <span
          class="badge badge-sm {badgeClass}"
          title={statusView.error ?? statusView.statusLabel}
        >
          {#if statusView.busy}
            <span class="loading loading-spinner loading-[10px]"></span>
          {/if}
          {statusView.statusLabel}
        </span>
      {:else if statusError}
        <span class="badge badge-sm badge-error" title={statusError}>Status error</span>
      {:else}
        <span class="badge badge-sm badge-ghost">—</span>
      {/if}

      <button
        type="button"
        class="btn btn-ghost btn-xs"
        disabled={testing}
        onclick={runTest}
        title={testResult
          ? testResult.ok
            ? "Connection OK"
            : (testResult.error ?? "Failed")
          : "Test connection"}
      >
        {#if testing}
          <span class="loading loading-spinner loading-[10px]"></span>
        {:else if testResult?.ok}
          <span class="text-success">✓</span>
        {:else if testResult}
          <span class="text-error">✗</span>
        {:else}
          Test
        {/if}
      </button>

      {#if testResult}
        <span class="text-xs {testResult.ok ? 'text-success' : 'text-error'}">
          {testResult.ok ? "OK" : (testResult.error ?? "Failed")}
        </span>
      {/if}
    </div>
    {#if statusView?.error}
      <p class="text-xs text-error">{statusView.error}</p>
    {/if}
  {:else if computers.length === 0}
    <p class="text-xs opacity-50">
      No computers discovered — add a `Host` block to your `~/.ssh/config` to use a remote computer.
    </p>
  {:else if justSaved && !error}
    <p class="text-xs text-success">Saved.</p>
  {/if}

  {#if error}
    <p class="text-xs text-error">{error}</p>
  {/if}

  <p class="text-xs opacity-50">
    Where this conversation's tools run. `null` (Local) runs on the server; an alias runs over SSH.
    Not seen by the agent.
  </p>
</div>
