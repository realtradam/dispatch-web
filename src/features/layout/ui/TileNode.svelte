<script lang="ts">
  /**
   * The recursive tile dispatcher: renders the node for its `kind` and recurses
   * through the container components. Leaf nodes resolve through the view
   * registry (TileLeaf).
   */
  import type { LayoutNode, LayoutOp, Path } from "@dispatch/layout-contract";
  import type { CollapseStore } from "../logic/collapse";
  import TileLeaf from "./TileLeaf.svelte";
  import TilePanels from "./TilePanels.svelte";
  import TileSplit from "./TileSplit.svelte";
  import TileStack from "./TileStack.svelte";

  let {
    node,
    path,
    ports,
    collapse,
    onEdit,
  }: {
    node: LayoutNode;
    path: Path;
    ports?: unknown;
    collapse: CollapseStore;
    onEdit: (ops: readonly LayoutOp[]) => void;
  } = $props();
</script>

{#if node.kind === "split"}
  <TileSplit {node} {path} {ports} {collapse} {onEdit} />
{:else if node.kind === "stack"}
  <TileStack {node} {path} {ports} {collapse} {onEdit} />
{:else if node.kind === "panels"}
  <TilePanels {node} {path} {ports} {onEdit} />
{:else if node.kind === "leaf"}
  <TileLeaf {node} {ports} />
{/if}
