<script lang="ts">
  /**
   * The `cache-warming` view — the backend's conversation-scoped cache-warming
   * surface with the WarmNow adapter. Re-mounts per conversation (like
   * ChatView) so the view's local warming history / manual-warm feedback
   * can't bleed across tabs (the {#key} moved inside the wrapper).
   */
  import { CacheWarmingView, type WarmFeedback } from "../../features/cache-warming";
  import type { AppViewPorts } from "../view-ports";

  const CACHE_WARMING_ID = "cache-warming";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // Adapt the store's WarmResult to the cache-warming feature's WarmNow port.
  async function warmNow(): Promise<WarmFeedback | null> {
    const result = await store.warmNow();
    if (result === null) return null;
    return result.ok
      ? {
          ok: true,
          cachePct: result.response.cachePct,
          expectedCacheRate: result.response.expectedCacheRate,
        }
      : { ok: false, error: result.error };
  }
</script>

{#key store.activeConversationId}
  <CacheWarmingView
    spec={store.surface(CACHE_WARMING_ID)}
    canWarm={store.activeConversationId !== null}
    onInvoke={(msg) => store.invoke(msg.surfaceId, msg.actionId, msg.payload)}
    {warmNow}
  />
{/key}
