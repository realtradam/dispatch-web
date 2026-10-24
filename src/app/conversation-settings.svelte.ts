import type {
  CompactPercentResponse,
  ConversationComputerResponse,
  CwdResponse,
  LspStatusResponse,
  McpStatusResponse,
  ReasoningEffort,
  ReasoningEffortResponse,
  SetCompactPercentRequest,
  SetConversationComputerRequest,
  SetCwdRequest,
  SetReasoningEffortRequest,
  SetVisionSettingsRequest,
} from "@dispatch/transport-contract";
import { untrack } from "svelte";
import type { SetThinkingRequest, ThinkingResponse } from "../features/chat/reasoning-effort";
import {
  normalizeVisionSettings,
  type VisionSettings,
  type VisionSettingsPatch,
} from "../features/vision";

import type {
  CompactPercentResult,
  ComputerResult,
  CwdResult,
  LspResult,
  McpResult,
  ReasoningEffortResult,
  ThinkingResult,
  VisionSettingsResult,
} from "./store-types";

/** Conversation settings keep their original reactive cells and response guards. */
export function createConversationSettings(deps: {
  httpBase: string;
  fetchImpl: typeof fetch;
  workspaceConversationId: () => string;
  activeWorkspaceId: () => string;
  reportError: (context: string, err: unknown) => void;
}) {
  const { httpBase, fetchImpl } = deps;
  // The active conversation's persisted working directory (per-tab). Seeded from
  // the backend on focus change; null for a draft / when unset.
  let cwd = $state<string | null>(null);

  /** Refetch the workspace conversation's cwd into reactive state (works for a draft too). */
  async function refreshCwd(): Promise<void> {
    const id = deps.workspaceConversationId();
    try {
      const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/cwd`);
      if (!res.ok) return;
      const data = (await res.json()) as CwdResponse;
      // Guard a slow response losing a race with a conversation switch.
      if (deps.workspaceConversationId() === id) cwd = data.cwd ?? null;
    } catch (err) {
      deps.reportError("Failed to load working directory", err);
    }
  }

  // The active conversation's persisted computer (SSH Host alias). Seeded on
  // focus change; null = local / never set (inherits the workspace default).
  let computerId = $state<string | null>(null);

  /**
   * Refetch the workspace conversation's persisted computer into reactive state
   * (works for a draft too). A draft's id 404s until promoted; `res.ok` is false
   * so it is a silent no-op (mirrors `refreshCwd` for a draft).
   */
  async function refreshComputer(): Promise<void> {
    const id = deps.workspaceConversationId();
    // Clear immediately so a switch never shows the PREVIOUS conversation's
    // computer while the fetch is in flight (null renders as "Local").
    computerId = null;
    try {
      const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/computer`);
      if (!res.ok) return;
      const data = (await res.json()) as ConversationComputerResponse;
      // Guard a slow response losing a race with a conversation switch.
      if (deps.workspaceConversationId() === id) computerId = data.computerId ?? null;
    } catch (err) {
      deps.reportError("Failed to load computer", err);
    }
  }

  // The workspace conversation's persisted reasoning effort. Seeded from the
  // backend on focus change; null = never set (the server default applies).
  let reasoningEffort = $state<ReasoningEffort | null>(null);

  /** Refetch the workspace conversation's reasoning effort (works for a draft too). */
  async function refreshReasoningEffort(): Promise<void> {
    const id = deps.workspaceConversationId();
    // Clear immediately so a switch never shows the PREVIOUS conversation's level
    // while the fetch is in flight (null renders as the server default).
    reasoningEffort = null;
    try {
      const res = await fetchImpl(
        `${httpBase}/conversations/${encodeURIComponent(id)}/reasoning-effort`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as ReasoningEffortResponse;
      // Guard a slow response losing a race with a conversation switch.
      if (deps.workspaceConversationId() === id) reasoningEffort = data.reasoningEffort ?? null;
    } catch (err) {
      deps.reportError("Failed to load reasoning effort", err);
    }
  }

  // The workspace conversation's persisted thinking flag (SEPARATE from the
  // effort level). Seeded from the backend on focus change; null = never set
  // (thinking ON — the default). PROPOSED endpoint (see backend-handoff.md):
  // a 404 (endpoint not yet shipped) leaves `thinking` null ⇒ ON (default), so
  // the selector simply shows the effort level until the backend ships it.
  let thinking = $state<boolean | null>(null);

  /** Refetch the workspace conversation's thinking flag (works for a draft too). */
  async function refreshThinking(): Promise<void> {
    const id = deps.workspaceConversationId();
    // Clear immediately so a switch never shows the PREVIOUS conversation's
    // setting while the fetch is in flight (null ⇒ ON, the default).
    thinking = null;
    try {
      const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/thinking`);
      if (!res.ok) return;
      // Guard against the SPA fallback: when DISPATCH_WEB_DIR is set (production),
      // unknown API routes get index.html with HTTP 200 + text/html instead of a
      // 404. Treat any non-JSON 200 as "endpoint not shipped" → leave null (ON).
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return;
      const data = (await res.json()) as ThinkingResponse;
      // Guard a slow response losing a race with a conversation switch.
      if (deps.workspaceConversationId() === id) thinking = data.thinking ?? null;
    } catch (err) {
      deps.reportError("Failed to load thinking setting", err);
    }
  }

  // The workspace conversation's auto-compact percent. Seeded from the
  // backend on focus change; null = not yet fetched. 0 = disabled.
  let compactPercent = $state<number | null>(null);

  // The GLOBAL vision settings (shared across all conversations). Seeded on
  // boot; null = not yet fetched.
  let visionSettings = $state<VisionSettings | null>(null);

  /** Refetch the global vision settings (`GET /settings/vision`). */
  async function refreshVisionSettings(): Promise<void> {
    try {
      const res = await fetchImpl(`${httpBase}/settings/vision`);
      if (!res.ok) return;
      const data = normalizeVisionSettings(await res.json());
      visionSettings = data;
    } catch (err) {
      deps.reportError("Failed to load vision settings", err);
    }
  }

  /** Refetch the workspace conversation's compact percent (works for a draft too). */
  async function refreshCompactPercent(): Promise<void> {
    const id = deps.workspaceConversationId();
    compactPercent = null;
    try {
      const res = await fetchImpl(
        `${httpBase}/conversations/${encodeURIComponent(id)}/compact-percent`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as CompactPercentResponse;
      if (deps.workspaceConversationId() === id) compactPercent = data.threshold;
    } catch (err) {
      deps.reportError("Failed to load compact percent", err);
    }
  }
  return {
    refreshCwd,
    refreshComputer,
    refreshReasoningEffort,
    refreshThinking,
    refreshCompactPercent,
    refreshVisionSettings,
    get cwd() {
      return cwd;
    },
    get computerId() {
      return computerId;
    },
    get reasoningEffort() {
      return reasoningEffort;
    },
    get thinking() {
      return thinking;
    },
    get compactPercent() {
      return compactPercent;
    },
    get visionSettings() {
      return visionSettings;
    },
    async setCwd(value: string): Promise<CwdResult | null> {
      const id = deps.workspaceConversationId();
      const body: SetCwdRequest = {
        cwd: value,
        workspaceId: untrack(deps.activeWorkspaceId),
      };
      try {
        const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/cwd`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, error: errBody?.error ?? `Set cwd failed (HTTP ${res.status})` };
        }
        const data = (await res.json()) as CwdResponse;
        const next = data.cwd ?? null;
        if (deps.workspaceConversationId() === id) cwd = next;
        return { ok: true, cwd: next };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Set cwd request failed" };
      }
    },

    async setComputer(computerIdValue: string | null): Promise<ComputerResult | null> {
      const id = deps.workspaceConversationId();
      const body: SetConversationComputerRequest = { computerId: computerIdValue };
      try {
        const res = await fetchImpl(
          `${httpBase}/conversations/${encodeURIComponent(id)}/computer`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set computer failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as ConversationComputerResponse;
        const next = data.computerId ?? null;
        if (deps.workspaceConversationId() === id) computerId = next;
        return { ok: true, computerId: next };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set computer request failed",
        };
      }
    },

    async setReasoningEffort(level: ReasoningEffort): Promise<ReasoningEffortResult | null> {
      const id = deps.workspaceConversationId();
      const body: SetReasoningEffortRequest = { reasoningEffort: level };
      try {
        const res = await fetchImpl(
          `${httpBase}/conversations/${encodeURIComponent(id)}/reasoning-effort`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set reasoning effort failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as ReasoningEffortResponse;
        const next = data.reasoningEffort ?? level;
        if (deps.workspaceConversationId() === id) reasoningEffort = next;
        return { ok: true, reasoningEffort: next };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set reasoning effort request failed",
        };
      }
    },

    async setThinking(enabled: boolean): Promise<ThinkingResult | null> {
      const id = deps.workspaceConversationId();
      const body: SetThinkingRequest = { thinking: enabled };
      try {
        const res = await fetchImpl(
          `${httpBase}/conversations/${encodeURIComponent(id)}/thinking`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set thinking failed (HTTP ${res.status})`,
          };
        }
        // Guard against the SPA fallback (200 + text/html when the endpoint
        // is not shipped). Optimistically apply locally — the backend can't
        // persist it, but the UI reflects the user's intent for this session.
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          if (deps.workspaceConversationId() === id) thinking = enabled;
          return { ok: true, thinking: enabled };
        }
        const data = (await res.json()) as ThinkingResponse;
        const next = data.thinking ?? enabled;
        if (deps.workspaceConversationId() === id) thinking = next;
        return { ok: true, thinking: next };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set thinking request failed",
        };
      }
    },
    async setCompactPercent(percent: number): Promise<CompactPercentResult | null> {
      const id = deps.workspaceConversationId();
      const body: SetCompactPercentRequest = { threshold: percent };
      try {
        const res = await fetchImpl(
          `${httpBase}/conversations/${encodeURIComponent(id)}/compact-percent`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set compact percent failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as CompactPercentResponse;
        if (deps.workspaceConversationId() === id) compactPercent = data.threshold;
        return { ok: true, percent: data.threshold };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set compact percent request failed",
        };
      }
    },

    async setVisionSettings(patch: VisionSettingsPatch): Promise<VisionSettingsResult | null> {
      const body: SetVisionSettingsRequest = patch;
      try {
        const res = await fetchImpl(`${httpBase}/settings/vision`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set vision settings failed (HTTP ${res.status})`,
          };
        }
        const data = normalizeVisionSettings(await res.json());
        visionSettings = data;
        return { ok: true, settings: data };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set vision settings request failed",
        };
      }
    },
    async lspStatus(): Promise<LspResult | null> {
      const id = deps.workspaceConversationId();
      try {
        const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/lsp`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, error: errBody?.error ?? `LSP status failed (HTTP ${res.status})` };
        }
        // Normalize the untyped body at this network seam so a malformed/partial
        // response can never crash the renderer (servers is guaranteed an array).
        const data = (await res.json()) as Partial<LspStatusResponse>;
        const response: LspStatusResponse = {
          conversationId: data.conversationId ?? id,
          cwd: data.cwd ?? null,
          servers: Array.isArray(data.servers) ? data.servers : [],
        };
        return { ok: true, response };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "LSP status request failed",
        };
      }
    },

    async mcpStatus(): Promise<McpResult | null> {
      const id = deps.workspaceConversationId();
      try {
        const res = await fetchImpl(`${httpBase}/conversations/${encodeURIComponent(id)}/mcp`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, error: errBody?.error ?? `MCP status failed (HTTP ${res.status})` };
        }
        // Normalize the untyped body at this network seam so a malformed/partial
        // response can never crash the renderer (servers is guaranteed an array).
        const data = (await res.json()) as Partial<McpStatusResponse>;
        const response: McpStatusResponse = {
          conversationId: data.conversationId ?? id,
          cwd: data.cwd ?? null,
          servers: Array.isArray(data.servers) ? data.servers : [],
        };
        return { ok: true, response };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "MCP status request failed",
        };
      }
    },
  };
}
