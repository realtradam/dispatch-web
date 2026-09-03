<script lang="ts">
  import type { PluginNode } from "../logic/types";
  import { tierLabel } from "../logic/types";
  import { groupByTier } from "../logic/view-model";
  import PluginRow from "./PluginRow.svelte";

  let {
    title,
    rows,
    blockReasonFor,
    highlightFor,
    busyIds,
    onToggle,
    onReload,
    onHover,
    onUnhover,
  }: {
    title: string;
    rows: readonly PluginNode[];
    /**
     * Why a row's control is disabled (core-locked / last-provider), or null
     * when interactive. Injected by the manager (it owns the graph context).
     */
    blockReasonFor: (id: string) => string | null;
    /**
     * The §8 hover-highlight state for one row: a highlighted dependency, a
     * highlighted dependent, or none. Injected by the manager (it owns the
     * hovered id + the graph).
     */
    highlightFor: (id: string) => "dep" | "dependent" | null;
    /** Ids with an in-flight mutation (spinner in their controls). */
    busyIds: ReadonlySet<string>;
    onToggle: (node: PluginNode, checked: boolean) => void;
    onReload?: (node: PluginNode) => void;
    onHover: (id: string) => void;
    onUnhover: (id: string) => void;
  } = $props();

  // Tier-grouped rows (Core → Providers → Standard) per the plan-07 decision.
  const groups = $derived(groupByTier(rows));
</script>

<section class="flex flex-col gap-1">
  <h4 class="text-xs font-semibold uppercase opacity-60">{title}</h4>
  {#if rows.length === 0}
    <p class="text-xs opacity-50">Nothing here.</p>
  {:else}
    <table class="table table-sm">
      <thead>
        <tr>
          <th class="w-10">
            <span class="sr-only">Load/unload</span>
          </th>
          <th>Plugin</th>
          <th>Class</th>
          <th>Version</th>
          <th class="text-right">
            <span class="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {#each groups as group (group.tier)}
        <tbody>
          <tr>
            <td colspan="5" class="bg-base-200/40 text-xs font-semibold uppercase opacity-60">
              {tierLabel(group.tier)}
            </td>
          </tr>
          {#each group.rows as node (node.id)}
            <PluginRow
              {node}
              highlight={highlightFor(node.id)}
              blockReason={blockReasonFor(node.id)}
              busy={busyIds.has(node.id)}
              {onToggle}
              {...(onReload ? { onReload } : {})}
              {onHover}
              {onUnhover}
            />
          {/each}
        </tbody>
      {/each}
    </table>
  {/if}
</section>
