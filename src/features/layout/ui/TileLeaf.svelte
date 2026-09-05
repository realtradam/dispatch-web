<script lang="ts">
  /**
   * Mounts a registered view for a leaf node. Resolution goes through the
   * REACTIVE registry, so a late registration (plan 03) swaps the tile in
   * without a tree change. An unknown view id renders a fallback tile —
   * NEVER a crash (backend-owned trees can name views this client lacks).
   *
   * A diagnostic `marker` on the leaf draws an outline around it — the only
   * node kind without a natural tile wrapper, so the wrapper exists only
   * when marked (unmarked leaves render exactly as before).
   */
  import type { TileMarker } from "@dispatch/layout-contract";
  import { viewRegistry, type RegisteredView } from "../logic/registry";
  import { markerOutline } from "../logic/marker";
  import FallbackTile from "./FallbackTile.svelte";

  let {
    node,
    ports,
  }: {
    node: { readonly view: string; readonly marker?: TileMarker };
    ports?: unknown;
  } = $props();

  const entry: RegisteredView | undefined = $derived(
    $viewRegistry.find((v) => v.id === node.view),
  );
  const View = $derived(entry?.component);
  const outline = $derived(markerOutline(node.marker));
</script>

{#snippet content()}
  {#if View}
    <View {ports} />
  {:else}
    <FallbackTile viewId={node.view} />
  {/if}
{/snippet}

{#if outline !== undefined}
  <div style:outline={outline}>{@render content()}</div>
{:else}
  {@render content()}
{/if}
