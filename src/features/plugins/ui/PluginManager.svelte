<script lang="ts">
  import { onMount } from "svelte";
  import type { PluginsStore } from "../store.svelte";
  import type { PluginNode } from "../logic/types";
  import { computeCascade } from "../logic/cascade";
  import { autoCheckBackendPrereqs } from "../logic/prereqs";
  import { dependencyHighlightSets } from "../logic/highlight";
  import { unloadBlockReason } from "../logic/last-provider";
  import { splitSections, withFrontendStates } from "../logic/view-model";
  import PluginTable from "./PluginTable.svelte";
  import UnloadConfirmModal from "./UnloadConfirmModal.svelte";

  let { plugins, onClose }: { plugins: PluginsStore; onClose: () => void } = $props();

  onMount(() => {
    void plugins.refresh();
  });

  // ── Derived sections + hover highlighting (§8) ────────────────────────────
  // The FE-half states (plan 03) merge into the nodes here — one reactive
  // derivation over both inputs (the normalized nodes + the plugin host's
  // post-sync state map).
  const nodes = $derived(withFrontendStates(plugins.nodes, plugins.frontendStates));
  const sections = $derived(splitSections(nodes));
  let hoveredId = $state<string | null>(null);
  const highlight = $derived(dependencyHighlightSets(hoveredId, nodes));

  function highlightFor(id: string): "dep" | "dependent" | null {
    if (highlight.deps.has(id)) return "dep";
    if (highlight.dependents.has(id)) return "dependent";
    return null;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  let busyIds = $state<ReadonlySet<string>>(new Set());
  let scanning = $state(false);

  async function withBusy(id: string, op: () => Promise<unknown>): Promise<void> {
    busyIds = new Set(busyIds).add(id);
    try {
      await op();
    } finally {
      const next = new Set(busyIds);
      next.delete(id);
      busyIds = next;
    }
  }

  // ── Unload confirm state (cascade warn §8 + in-use force §8) ─────────────
  // The pending unload the confirm modal describes. `cascade` lists the loaded
  // dependents that will also be unchecked; `notice` carries a refused-attempt
  // error (in-use / engine refusal) that motivated the force offer.
  let pendingUnload = $state<{
    node: PluginNode;
    cascade: readonly string[];
    notice: string | null;
  } | null>(null);

  async function toggle(node: PluginNode, checked: boolean): Promise<void> {
    if (busyIds.has(node.id)) return;
    if (checked) {
      // §8: checking auto-checks the required backend plugins (transitive,
      // one-directional). Load the missing prereqs first, then the target.
      const prereqs = autoCheckBackendPrereqs(node.id, plugins.nodes);
      for (const id of prereqs) {
        await withBusy(id, () => plugins.load(id));
      }
      await withBusy(node.id, () => plugins.load(node.id));
      return;
    }
    // Unchecking: warn when loaded dependents would cascade-uncheck (§8).
    const cascade = computeCascade(node.id, plugins.nodes);
    if (cascade.length > 0) {
      pendingUnload = { node, cascade, notice: null };
      return;
    }
    // No local cascade — attempt the unload; a server refusal (in-use /
    // engine) offers force with the global-stop warning (§8).
    const result = await withBusyRes(node.id, () => plugins.unload(node.id, false));
    if (result !== null && !result.ok) {
      pendingUnload = { node, cascade: result.dependents ?? [], notice: result.error };
    }
  }

  /** Like `withBusy` but returns the op's result (for the unload flow). */
  async function withBusyRes<T>(id: string, op: () => Promise<T>): Promise<T | null> {
    busyIds = new Set(busyIds).add(id);
    try {
      return await op();
    } finally {
      const next = new Set(busyIds);
      next.delete(id);
      busyIds = next;
    }
  }

  async function confirmUnload(): Promise<void> {
    const pending = pendingUnload;
    pendingUnload = null;
    if (pending === null) return;
    // Force cascades the dependents server-side (plan 05: reverse-topological
    // unload) and stops ALL agents globally first — the modal's copy says so.
    await withBusy(pending.node.id, () => plugins.unload(pending.node.id, true));
  }

  function cancelUnload(): void {
    pendingUnload = null;
  }

  async function reload(node: PluginNode): Promise<void> {
    await withBusy(node.id, () => plugins.reload(node.id));
  }

  async function scan(): Promise<void> {
    scanning = true;
    await plugins.scan();
    scanning = false;
  }

  const scanSummary = $derived.by(() => {
    const last = plugins.lastScan;
    if (last === null || !last.ok) return null;
    const r = last.response;
    const parts: string[] = [`${r.newPlugins.length} new`];
    if (r.invalid.length > 0) parts.push(`${r.invalid.length} invalid`);
    if (r.incompatible.length > 0) parts.push(`${r.incompatible.length} incompatible`);
    return `Scan of ${r.root}: ${parts.join(", ")}`;
  });
</script>

<div class="modal modal-open" role="dialog" aria-label="Plugin manager">
  <div class="modal-box max-w-3xl">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-bold">Plugin manager</h3>
      <button
        type="button"
        class="btn btn-sm"
        disabled={scanning}
        onclick={scan}
        title="Rescan the plugin directory (new plugins stay unloaded — the consent gate)"
      >
        {#if scanning}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          Scan
        {/if}
      </button>
    </div>

    {#if plugins.error}
      <p class="mt-2 text-xs text-error" role="alert">{plugins.error}</p>
    {/if}
    {#if scanSummary}
      <p class="mt-2 text-xs opacity-70" role="status">{scanSummary}</p>
    {/if}

    <div class="mt-3 flex flex-col gap-4">
      <PluginTable
        title="Loaded"
        rows={sections.loaded}
        blockReasonFor={(id) => unloadBlockReason(id, plugins.nodes)}
        {highlightFor}
        {busyIds}
        onToggle={toggle}
        onReload={reload}
        onHover={(id) => (hoveredId = id)}
        onUnhover={(id) => (hoveredId = hoveredId === id ? null : hoveredId)}
      />

      <PluginTable
        title="Discovered (not loaded)"
        rows={sections.discovered}
        blockReasonFor={() => null}
        {highlightFor}
        {busyIds}
        onToggle={toggle}
        onHover={(id) => (hoveredId = id)}
        onUnhover={(id) => (hoveredId = hoveredId === id ? null : hoveredId)}
      />

      {#if sections.missing.length > 0}
        <section class="flex flex-col gap-1">
          <h4 class="text-xs font-semibold uppercase opacity-60">Missing (directory gone)</h4>
          <ul class="flex flex-col gap-1">
            {#each sections.missing as node (node.id)}
              <li class="rounded bg-base-200/40 px-2 py-1 text-xs opacity-60">
                <span class="font-mono">{node.id}</span> — {node.reason}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <div class="modal-action">
      <p class="mr-auto self-center text-xs opacity-50">
        Hover a row to highlight its dependencies and dependents.
      </p>
      <button type="button" class="btn btn-sm" onclick={onClose}>Close</button>
    </div>
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={onClose}></div>
</div>

{#if pendingUnload !== null}
  <UnloadConfirmModal
    headline={pendingUnload.node.loaded ? `Unload ${pendingUnload.node.id}?` : `Force-unload ${pendingUnload.node.id}?`}
    lines={[
      ...(pendingUnload.cascade.length > 0
        ? [
            `Unloading ${pendingUnload.node.id} also unchecks: ${pendingUnload.cascade.join(", ")}.`,
          ]
        : []),
      ...(pendingUnload.notice !== null ? [pendingUnload.notice] : []),
    ]}
    confirmLabel={pendingUnload.cascade.length > 0 ? "Unload with force" : "Force unload"}
    onCancel={cancelUnload}
    onConfirm={confirmUnload}
  />
{/if}
