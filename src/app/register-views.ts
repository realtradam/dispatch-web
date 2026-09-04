/**
 * Built-in view registration — the composition root's view vocabulary.
 *
 * One thin wrapper component per existing view (src/app/views/*.svelte), each
 * closing over exactly the props/ports App.svelte's `viewContent` snippet used
 * to pass — INCLUDING each view's `{#key}` remount semantics (moved INSIDE the
 * wrappers). Registry ids match the old `viewKinds` ids exactly: no
 * user-facing renaming, no persistence-key changes.
 *
 * `chat` / `composer` / `message-queue` are CONTENT views (decision 5): they
 * register with `panelEligible: false` so they never appear in the panel
 * dropdowns. All 14 sidebar views keep the eligible default.
 *
 * Imported ONCE by App.svelte's module script — before any tile renders.
 */

import type { Component } from "svelte";
import { registerView, type ViewComponent, type ViewRegistration } from "../features/layout";
import type { AppViewPorts } from "./view-ports";
import CacheWarmingPane from "./views/CacheWarmingPane.svelte";
import ChatPane from "./views/ChatPane.svelte";
import CompactionPane from "./views/CompactionPane.svelte";
import ComposerPane from "./views/ComposerPane.svelte";
import ConcurrencyPane from "./views/ConcurrencyPane.svelte";
import ExtensionsPane from "./views/ExtensionsPane.svelte";
import HeartbeatPane from "./views/HeartbeatPane.svelte";
import LspPane from "./views/LspPane.svelte";
import McpPane from "./views/McpPane.svelte";
import MessageQueuePane from "./views/MessageQueuePane.svelte";
import ModelPane from "./views/ModelPane.svelte";
import NamedAgentsPane from "./views/NamedAgentsPane.svelte";
import SettingsPane from "./views/SettingsPane.svelte";
import SystemPromptPane from "./views/SystemPromptPane.svelte";
import TabsPane from "./views/TabsPane.svelte";
import TasksPane from "./views/TasksPane.svelte";
import VisionPane from "./views/VisionPane.svelte";

/**
 * Every wrapper takes `{ ports: AppViewPorts }` and TileLeaf supplies it — but
 * the registry is a HETEROGENEOUS bag of components (generic `Component`), so
 * the composition root bridges each wrapper's concrete props type to the
 * registry's opaque one. ONE controlled cast at this seam (the renderer always
 * passes the port bag; the wrappers re-narrow it) instead of `any` in the
 * contract.
 */
type WrapperComponent = Component<{ ports: AppViewPorts }>;
function asView(component: WrapperComponent): ViewComponent {
  return component as unknown as ViewComponent;
}

export function registerBuiltinViews(): void {
  const views: readonly ViewRegistration[] = [
    // --- sidebar views (panel-eligible by default — the 14 old viewKinds)
    { id: "tabs", label: "Tabs", component: asView(TabsPane) },
    { id: "model", label: "Model", component: asView(ModelPane) },
    { id: "named-agents", label: "Named Agents", component: asView(NamedAgentsPane) },
    { id: "lsp", label: "Language Servers", component: asView(LspPane) },
    { id: "mcp", label: "MCP Servers", component: asView(McpPane) },
    { id: "extensions", label: "Extensions", component: asView(ExtensionsPane) },
    { id: "cache-warming", label: "Cache Warming", component: asView(CacheWarmingPane) },
    { id: "tasks", label: "Tasks", component: asView(TasksPane) },
    { id: "compaction", label: "Compaction", component: asView(CompactionPane) },
    { id: "vision", label: "Vision", component: asView(VisionPane) },
    { id: "heartbeat", label: "Heartbeat", component: asView(HeartbeatPane) },
    { id: "concurrency", label: "Concurrency", component: asView(ConcurrencyPane) },
    { id: "system-prompt", label: "System Prompt", component: asView(SystemPromptPane) },
    { id: "settings", label: "Settings", component: asView(SettingsPane) },
    // --- content views (never in the panel dropdowns — decision 5)
    { id: "chat", label: "Chat", component: asView(ChatPane), panelEligible: false },
    { id: "composer", label: "Composer", component: asView(ComposerPane), panelEligible: false },
    {
      id: "message-queue",
      label: "Message Queue",
      component: asView(MessageQueuePane),
      panelEligible: false,
    },
  ];
  for (const view of views) registerView(view);
}
