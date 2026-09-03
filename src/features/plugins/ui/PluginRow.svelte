<script lang="ts">
  import type { PluginNode } from "../logic/types";
  import { tierLabel } from "../logic/types";

  let {
    node,
    highlight,
    blockReason = null,
    busy = false,
    onToggle,
    onReload,
    onHover,
    onUnhover,
  }: {
    node: PluginNode;
    /** Hover-highlight state for this row: a direct dep, a dependent, or none. */
    highlight: "dep" | "dependent" | null;
    /**
     * Why the unload control is disabled (core-locked / last-provider), or
     * null when interactive. Missing rows are always disabled (no plugin).
     */
    blockReason?: string | null;
    /** Whether a mutation for this row is in flight (spinner in the controls). */
    busy?: boolean;
    onToggle: (node: PluginNode, checked: boolean) => void;
    onReload?: (node: PluginNode) => void;
    onHover: (id: string) => void;
    onUnhover: (id: string) => void;
  } = $props();

  // Missing rows have no checkbox at all — there is no plugin to load.
  const hasCheckbox = $derived(node.section !== "missing");
  // Core rows are LOCKED (no load/unload control) per §3/§5.
  const interactive = $derived(blockReason === null && !busy);
  const rowClass = $derived(
    [
      node.section === "missing" || node.locked || (!node.loaded && node.section === "discovered")
        ? "opacity-50"
        : "",
      highlight === "dep"
        ? "outline outline-1 outline-info bg-info/10"
        : highlight === "dependent"
          ? "outline outline-1 outline-warning bg-warning/10"
          : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<tr
  class={rowClass}
  onmouseover={() => onHover(node.id)}
  onmouseout={() => onUnhover(node.id)}
  onfocus={() => onHover(node.id)}
  onblur={() => onUnhover(node.id)}
>
  <td class="w-10">
    {#if hasCheckbox}
      {#if node.locked}
        <span
          class="inline-block w-4 text-center opacity-40"
          title={blockReason ?? "Core plugins cannot be unloaded"}
          aria-label="Locked (core)">🔒</span
        >
      {:else}
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          checked={node.loaded}
          disabled={!interactive}
          title={blockReason ?? undefined}
          aria-label={`${node.loaded ? "Unload" : "Load"} ${node.id}`}
          onchange={(e) => onToggle(node, e.currentTarget.checked)}
        />
      {/if}
    {/if}
  </td>
  <td>
    <div class="flex flex-col">
      <span class="font-medium">{node.name}</span>
      {#if node.reason !== null}
        <span class="text-xs text-error">{node.reason}</span>
      {/if}
      {#if node.dependsOn.length > 0}
        <span class="text-xs opacity-60">depends on: {node.dependsOn.join(", ")}</span>
      {/if}
    </div>
  </td>
  <td class="text-xs">
    <span class="badge badge-ghost badge-sm">{tierLabel(node.tier)}</span>
    {#if node.trust !== null}
      <span class="badge badge-ghost badge-sm">{node.trust}</span>
    {/if}
  </td>
  <td class="text-xs opacity-60">{node.version}</td>
  <td class="text-right">
    {#if node.loaded && onReload !== undefined}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        disabled={!interactive}
        title="Reload this plugin's code (picks up updates)"
        aria-label={`Reload ${node.id}`}
        onclick={() => onReload?.(node)}
      >
        {#if busy}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          ↻
        {/if}
      </button>
    {/if}
  </td>
</tr>
