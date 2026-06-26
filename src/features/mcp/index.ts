export type { LoadMcpStatus, McpStatusResult } from "./logic/view-model";
export { default as McpStatusView } from "./ui/McpStatusView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "mcp",
  description: "Per-conversation MCP (Model Context Protocol) server status",
} as const;
