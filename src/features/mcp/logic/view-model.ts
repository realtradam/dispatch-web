import type { McpServerInfo, McpServerState } from "@dispatch/transport-contract";

/**
 * Pure core for the mcp feature — zero DOM, zero effects, zero Svelte.
 *
 * The mcp feature exposes the live status of the MCP (Model Context Protocol)
 * servers configured for a conversation's working directory, fetched from
 * `GET /conversations/:id/mcp`. This module holds the pure logic: the mapping
 * of a backend `McpServerState` to a display badge + label, and a one-line
 * server summary. The effect (the HTTP get MCP status) is INJECTED via the
 * `LoadMcpStatus` port below; the composition root implements it.
 */

// ── Injected port (consumer-defines-port; the composition root adapts the
//    store's HTTP call to this shape). ──────────────────────────────────────────

/** Outcome of `GET /conversations/:id/mcp`; `null` when no real conversation is focused. */
export type McpStatusResult =
  | { readonly ok: true; readonly cwd: string | null; readonly servers: readonly McpServerInfo[] }
  | { readonly ok: false; readonly error: string };

export type LoadMcpStatus = () => Promise<McpStatusResult | null>;

// ── MCP server status → display view ───────────────────────────────────────────

export type Badge = "success" | "warning" | "error" | "neutral";

export interface McpServerView {
  readonly id: string;
  readonly state: McpServerState;
  readonly statusLabel: string;
  readonly badge: Badge;
  /** True while the state is transient (show a spinner). */
  readonly busy: boolean;
  /** The error reason when `state === "error"`, else null. */
  readonly error: string | null;
  /** Number of tools discovered from this server. */
  readonly toolCount: number;
  /** Which config source the server was resolved from, else null. */
  readonly configSource: string | null;
}

/**
 * Map a server's state to a display label + badge severity + busy flag. Mirrors
 * the LSP status visual treatment: `connected` → success, `connecting` (the
 * transient state, analogous to LSP's `starting`) → warning + spinner, `error`
 * → error, and `disconnected` (a stable idle state) → neutral.
 */
export function viewMcpServer(server: McpServerInfo): McpServerView {
  let statusLabel: string;
  let badge: Badge;
  let busy = false;
  switch (server.state) {
    case "connected":
      statusLabel = "Connected";
      badge = "success";
      break;
    case "connecting":
      statusLabel = "Connecting…";
      badge = "warning";
      busy = true;
      break;
    case "disconnected":
      statusLabel = "Disconnected";
      badge = "neutral";
      break;
    case "error":
      statusLabel = "Error";
      badge = "error";
      break;
  }
  return {
    id: server.id,
    state: server.state,
    statusLabel,
    badge,
    busy,
    error: server.state === "error" ? (server.error ?? "Failed to connect") : null,
    toolCount: server.toolCount,
    configSource: server.configSource ?? null,
  };
}

export function viewMcpServers(servers: readonly McpServerInfo[]): readonly McpServerView[] {
  return servers.map(viewMcpServer);
}

/**
 * A short one-line summary, e.g. "2 connected" / "1 connected, 1 connecting,
 * 1 error". Only non-zero buckets are listed.
 */
export function summarizeMcpServers(servers: readonly McpServerInfo[]): string {
  if (servers.length === 0) return "No MCP servers";
  let connected = 0;
  let connecting = 0;
  let disconnected = 0;
  let errored = 0;
  for (const s of servers) {
    if (s.state === "connected") connected++;
    else if (s.state === "error") errored++;
    else if (s.state === "connecting") connecting++;
    else disconnected++;
  }
  const parts: string[] = [];
  if (connected > 0) parts.push(`${connected} connected`);
  if (connecting > 0) parts.push(`${connecting} connecting`);
  if (disconnected > 0) parts.push(`${disconnected} disconnected`);
  if (errored > 0) parts.push(`${errored} error${errored === 1 ? "" : "s"}`);
  return parts.join(", ");
}
