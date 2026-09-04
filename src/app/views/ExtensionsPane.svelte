<script lang="ts">
  /**
   * The `extensions` view — the frontend-modules table (aggregated from each
   * feature's public `manifest` so it can't drift from what's actually
   * composed) plus the generic surface list. The backend's "Loaded Extensions"
   * surface is a SEPARATE, backend-owned list. Unkeyed (like today).
   */
  import Table from "../../components/Table.svelte";
  import { manifest as cacheWarmingManifest } from "../../features/cache-warming";
  import { manifest as chatManifest } from "../../features/chat";
  import { manifest as concurrencyManifest } from "../../features/concurrency";
  import { manifest as conversationCacheManifest } from "../../features/conversation-cache";
  import { manifest as cwdLspManifest } from "../../features/cwd-lsp";
  import { manifest as computerManifest } from "../../features/computer";
  import { manifest as heartbeatManifest } from "../../features/heartbeat";
  import { manifest as layoutManifest } from "../../features/layout";
  import { manifest as markdownManifest } from "../../features/markdown";
  import { manifest as mcpManifest } from "../../features/mcp";
  import { manifest as namedAgentsManifest } from "../../features/named-agents";
  import { manifest as settingsManifest } from "../../features/settings";
  import { manifest as smartScrollManifest } from "../../features/smart-scroll";
  import { SurfaceView } from "../../features/surface-host";
  import { manifest as surfaceHostManifest } from "../../features/surface-host";
  import { manifest as systemPromptManifest } from "../../features/system-prompt";
  import { manifest as tabsManifest } from "../../features/tabs";
  import { manifest as viewsManifest } from "../../features/views";
  import { manifest as visionManifest } from "../../features/vision";
  import type { AppViewPorts } from "../view-ports";

  // Surfaces with dedicated renderers elsewhere stay out of the generic list:
  // cache-warming (its own view), message-queue (its own view), todo (the
  // Tasks view). SurfaceView itself stays fully generic (it never switches on
  // a surface id) — the FILTER is this view's data selection.
  const CACHE_WARMING_ID = "cache-warming";
  const MESSAGE_QUEUE_ID = "message-queue";
  const TODO_ID = "todo";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  const MODULE_COLUMNS = ["Module", "Description"] as const;
  // FE features are internal units of this single repo, so there is no
  // per-module version — they all share dispatch-web's version.
  const loadedModules: readonly (readonly [string, string])[] = [
    chatManifest,
    tabsManifest,
    surfaceHostManifest,
    viewsManifest,
    layoutManifest,
    conversationCacheManifest,
    markdownManifest,
    cacheWarmingManifest,
    cwdLspManifest,
    mcpManifest,
    computerManifest,
    smartScrollManifest,
    settingsManifest,
    systemPromptManifest,
    heartbeatManifest,
    concurrencyManifest,
    visionManifest,
    namedAgentsManifest,
  ].map((m) => [m.name, m.description] as const);
</script>

<section>
  <h3 class="mb-1 text-xs font-semibold uppercase opacity-60">Frontend modules</h3>
  <Table columns={MODULE_COLUMNS} rows={loadedModules} />
</section>
<section class="mt-4 flex flex-col gap-3">
  <h3 class="text-xs font-semibold uppercase opacity-60">Surfaces</h3>
  {#each store.surfaces.filter((s) => s.id !== CACHE_WARMING_ID && s.id !== MESSAGE_QUEUE_ID && s.id !== TODO_ID) as spec (spec.id)}
    <SurfaceView
      {spec}
      onInvoke={(msg) => store.invoke(msg.surfaceId, msg.actionId, msg.payload)}
    />
  {/each}
</section>
