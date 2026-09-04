<script lang="ts">
  /**
   * The `lsp` view — loaded language servers per conversation. Re-mounts per
   * conversation (incl. draft) so the loaded server list is isolated (the
   * {#key} moved inside the wrapper).
   */
  import { LspStatusView, type LspStatusResult } from "../../features/cwd-lsp";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  async function loadLspStatus(): Promise<LspStatusResult | null> {
    const result = await store.lspStatus();
    if (result === null) return null;
    return result.ok
      ? { ok: true, cwd: result.response.cwd, servers: result.response.servers }
      : { ok: false, error: result.error };
  }
</script>

{#key store.currentConversationId}
  <LspStatusView cwd={store.cwd} canView={true} load={loadLspStatus} />
{/key}
