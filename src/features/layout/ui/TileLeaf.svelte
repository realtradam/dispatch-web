<script lang="ts">
  /**
   * Mounts a registered view for a leaf node. Resolution goes through the
   * REACTIVE registry, so a late registration (plan 03) swaps the tile in
   * without a tree change. An unknown view id renders a fallback tile —
   * NEVER a crash (backend-owned trees can name views this client lacks).
   */
  import { viewRegistry, type RegisteredView } from "../logic/registry";
  import FallbackTile from "./FallbackTile.svelte";

  let { node, ports }: { node: { readonly view: string }; ports?: unknown } = $props();

  const entry: RegisteredView | undefined = $derived(
    $viewRegistry.find((v) => v.id === node.view),
  );
  const View = $derived(entry?.component);
</script>

{#if View}
  <View {ports} />
{:else}
  <FallbackTile viewId={node.view} />
{/if}
