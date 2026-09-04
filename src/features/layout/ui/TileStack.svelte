<script lang="ts">
  /**
   * A plain vertical container (today's left column). `grow` children flex
   * (`flex: grow 1 0%` — the chat region scrolls internally, exactly like
   * today's `flex-1`); children without grow take natural height.
   */
  import type { LayoutOp, Path, StackNode } from "@dispatch/layout-contract";
  import type { CollapseStore } from "../logic/collapse";
  import TileNode from "./TileNode.svelte";

  let {
    node,
    path,
    ports,
    collapse,
    onEdit,
  }: {
    node: StackNode;
    path: Path;
    ports?: unknown;
    collapse: CollapseStore;
    onEdit: (ops: readonly LayoutOp[]) => void;
  } = $props();
</script>

<div class="flex min-h-0 min-w-0 flex-col overflow-hidden">
  {#each node.children as child, i (i)}
    <div class="min-h-0 min-w-0" style={"flex: " + (child.grow ?? 0) + (child.grow === undefined ? " 0 auto" : " 1 0%")}>
      <TileNode node={child.node} path={[...path, i]} {ports} {collapse} {onEdit} />
    </div>
  {/each}
</div>
