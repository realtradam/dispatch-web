<script lang="ts">
  /**
   * Shown when a leaf names a view this client has not registered — the tree
   * is data and can arrive from a backend (plan 02) that knows views this
   * build lacks. A titled placeholder, never a crash.
   */
  let { viewId }: { viewId: string } = $props();
</script>

<div class="flex flex-col gap-1 rounded-lg bg-base-200 p-3" data-testid="fallback-tile">
  <h3 class="text-xs font-semibold uppercase opacity-60">{viewId}</h3>
  <p class="text-sm opacity-60">View not registered.</p>
</div>
