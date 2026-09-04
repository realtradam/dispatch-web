<script lang="ts">
  /**
   * The tile-tree root. Renders the tree (titlebar slot first — unset renders
   * nothing, D-L5), applies panel edit ops to its `tree` prop, and forwards the
   * new tree via `onTreeChange`. The OWNER decides what persistence means
   * (App/localStorage today; the backend layout store in plan 02).
   */
  import { applyOps, type LayoutOp, type LayoutTree } from "@dispatch/layout-contract";
  import type { CollapseStore } from "../logic/collapse";
  import TileNode from "./TileNode.svelte";

  let {
    tree,
    onTreeChange,
    ports,
    collapse,
  }: {
    tree: LayoutTree;
    onTreeChange?: (tree: LayoutTree) => void;
    ports?: unknown;
    collapse: CollapseStore;
  } = $props();

  function handleEdit(ops: readonly LayoutOp[]): void {
    const result = applyOps(tree, ops);
    if (result.ok) {
      onTreeChange?.(result.tree);
    } else {
      // A panel edit that fails validation (e.g. removing the last panel) is
      // refused loudly in dev — the tree keeps its previous state.
      console.error(`TileRoot: layout edit refused: ${result.error}`);
    }
  }
</script>

{#if tree.titlebar !== undefined}
  <TileNode node={tree.titlebar} path={["titlebar"]} {ports} {collapse} onEdit={handleEdit} />
{/if}
<TileNode node={tree.root} path={[]} {ports} {collapse} onEdit={handleEdit} />
