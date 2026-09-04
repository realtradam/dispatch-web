<script lang="ts">
  /**
   * The `heartbeat` view — workspace-scoped autonomous-agent heartbeat (config
   * + run history) with the store adapters. Opening a RUN raises the chrome
   * port: the run modal is app shell state (outside the tree — layout-00
   * decision 2). Unkeyed; the config + runs are per-workspace (like today).
   */
  import {
    HeartbeatView,
    type HeartbeatConfigResult,
    type HeartbeatNextRunResult,
    type HeartbeatRunView,
    type HeartbeatRunsResult,
    type HeartbeatStopResult,
  } from "../../features/heartbeat";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // Thin passthroughs (kept for structural consistency with cwd-lsp/mcp —
  // AGENTS.md "contracts are the cross-unit surface").
  async function loadHeartbeatConfig(): Promise<HeartbeatConfigResult> {
    return store.heartbeatConfig();
  }

  async function saveHeartbeatConfig(
    patch: Parameters<typeof store.setHeartbeatConfig>[0],
  ): Promise<HeartbeatConfigResult> {
    return store.setHeartbeatConfig(patch);
  }

  async function loadHeartbeatRuns(): Promise<HeartbeatRunsResult> {
    return store.heartbeatRuns();
  }

  async function stopHeartbeatRun(runId: string): Promise<HeartbeatStopResult> {
    return store.stopHeartbeatRun(runId);
  }

  async function loadHeartbeatNextRun(): Promise<HeartbeatNextRunResult> {
    return store.heartbeatNextRun();
  }
</script>

<HeartbeatView
  models={store.models}
  loadConfig={loadHeartbeatConfig}
  saveConfig={saveHeartbeatConfig}
  loadRuns={loadHeartbeatRuns}
  stopRun={stopHeartbeatRun}
  loadVariables={() => store.loadSystemPromptVariables()}
  loadDefaultPrompt={() => store.loadSystemPrompt()}
  loadNextRun={loadHeartbeatNextRun}
  onOpenRun={(run) => ports.openHeartbeatRun(run)}
/>
