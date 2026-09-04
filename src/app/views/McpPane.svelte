<script lang="ts">
  /**
   * The `mcp` view — loaded MCP servers per conversation. Re-mounts per
   * conversation (incl. draft) so the loaded server list is isolated (the
   * {#key} moved inside the wrapper).
   */
  import { McpStatusView, type McpStatusResult } from "../../features/mcp";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  async function loadMcpStatus(): Promise<McpStatusResult | null> {
    const result = await store.mcpStatus();
    if (result === null) return null;
    return result.ok
      ? { ok: true, cwd: result.response.cwd, servers: result.response.servers }
      : { ok: false, error: result.error };
  }
</script>

{#key store.currentConversationId}
  <McpStatusView cwd={store.cwd} canView={true} load={loadMcpStatus} />
{/key}
