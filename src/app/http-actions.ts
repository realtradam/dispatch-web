import type {
  CompactResponse,
  ComputerStatusResponse,
  SetSystemPromptTemplateRequest,
  SystemPromptTemplateResponse,
  SystemPromptVariablesResponse,
  TestComputerResponse,
  WarmRequest,
  WarmResponse,
} from "@dispatch/transport-contract";
import { untrack } from "svelte";
import type {
  AccountUsageProviderId,
  AccountUsageResult,
  AccountUsageSettingsResult,
  UpdateAccountUsageSettingsRequest,
} from "../features/account-usage";
import { normalizeAccountUsage, normalizeAccountUsageReport } from "../features/account-usage";
import type {
  ConcurrencyCooldownResult,
  ConcurrencyDeleteResult,
  ConcurrencyLimitResult,
  ConcurrencyLimitsResult,
  ConcurrencyStatusResult,
} from "../features/concurrency";
import {
  normalizeConcurrencyCooldown,
  normalizeConcurrencyLimit,
  normalizeConcurrencyLimits,
  normalizeConcurrencyStatus,
} from "../features/concurrency";
import type {
  HeartbeatConfig,
  HeartbeatConfigPatch,
  HeartbeatConfigResult,
  HeartbeatNextRunResult,
  HeartbeatRun,
  HeartbeatRunsResult,
  HeartbeatStopResult,
} from "../features/heartbeat";
import { normalizeHeartbeatConfig, normalizeHeartbeatRuns } from "../features/heartbeat";
import {
  normalizeSearchBackendConfig,
  type SearchBackendConfigResult,
} from "../features/search-settings";

import type {
  CompactResult,
  ComputerStatusResult,
  SystemPromptLoadResult,
  SystemPromptSaveResult,
  SystemPromptVariablesResult,
  TestComputerResult,
  WarmResult,
} from "./store-types";

/** Stateless app HTTP actions; callers inject the current focus/workspace. */
export function createHttpActions(deps: {
  httpBase: string;
  fetchImpl: typeof fetch;
  activeConversationId: () => string | null;
  activeModel: () => string;
  activeWorkspaceId: () => string;
  reportError: (context: string, err: unknown) => void;
}) {
  const { httpBase, fetchImpl } = deps;
  return {
    async warmNow(): Promise<WarmResult | null> {
      const conversationId = deps.activeConversationId();
      if (conversationId === null) return null;
      const body: WarmRequest = { conversationId, model: deps.activeModel() };
      try {
        const res = await fetchImpl(`${httpBase}/chat/warm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, error: errBody?.error ?? `Warm failed (HTTP ${res.status})` };
        }
        return { ok: true, response: (await res.json()) as WarmResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Warm request failed" };
      }
    },
    async computerStatus(alias: string): Promise<ComputerStatusResult | null> {
      if (alias === "") return null;
      try {
        const res = await fetchImpl(`${httpBase}/computers/${encodeURIComponent(alias)}/status`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Computer status failed (HTTP ${res.status})`,
          };
        }
        const status = (await res.json()) as ComputerStatusResponse;
        return { ok: true, response: status };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Computer status request failed",
        };
      }
    },

    async testComputer(alias: string): Promise<TestComputerResult | null> {
      if (alias === "") return null;
      try {
        const res = await fetchImpl(`${httpBase}/computers/${encodeURIComponent(alias)}/test`, {
          method: "POST",
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Test computer failed (HTTP ${res.status})`,
          };
        }
        const response = (await res.json()) as TestComputerResponse;
        return { ok: true, response };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Test computer request failed",
        };
      }
    },
    stopGeneration(): void {
      const conversationId = deps.activeConversationId();
      if (conversationId === null) return;
      void fetchImpl(`${httpBase}/conversations/${encodeURIComponent(conversationId)}/stop`, {
        method: "POST",
      }).catch((err) => {
        deps.reportError("Failed to stop generation", err);
      });
    },

    async compactNow(keepLastN?: number): Promise<CompactResult | null> {
      const conversationId = deps.activeConversationId();
      if (conversationId === null) return null;
      const body: Record<string, unknown> = {};
      if (keepLastN !== undefined) body.keepLastN = keepLastN;
      try {
        const res = await fetchImpl(
          `${httpBase}/conversations/${encodeURIComponent(conversationId)}/compact`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Compact failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as CompactResponse;
        return { ok: true, response: data };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Compact request failed",
        };
      }
    },
    async heartbeatConfig(): Promise<HeartbeatConfigResult> {
      // Workspace-scoped (NOT per-conversation): use the active workspace id.
      const wsId = untrack(deps.activeWorkspaceId);
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Heartbeat config failed (HTTP ${res.status})`,
          };
        }
        // Normalize the untyped JSON at the network seam (pure helper) so a
        // malformed/partial response can never crash the renderer.
        const config: HeartbeatConfig = normalizeHeartbeatConfig(await res.json());
        return { ok: true, config };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Heartbeat config request failed",
        };
      }
    },

    async setHeartbeatConfig(patch: HeartbeatConfigPatch): Promise<HeartbeatConfigResult> {
      const wsId = untrack(deps.activeWorkspaceId);
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set heartbeat config failed (HTTP ${res.status})`,
          };
        }
        const config: HeartbeatConfig = normalizeHeartbeatConfig(await res.json());
        return { ok: true, config };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set heartbeat config request failed",
        };
      }
    },

    async heartbeatRuns(): Promise<HeartbeatRunsResult> {
      const wsId = untrack(deps.activeWorkspaceId);
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat/runs`,
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Heartbeat runs failed (HTTP ${res.status})`,
          };
        }
        const runs: readonly HeartbeatRun[] = normalizeHeartbeatRuns(await res.json());
        return { ok: true, runs };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Heartbeat runs request failed",
        };
      }
    },

    async stopHeartbeatRun(runId: string): Promise<HeartbeatStopResult> {
      const wsId = untrack(deps.activeWorkspaceId);
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat/runs/${encodeURIComponent(runId)}/stop`,
          { method: "POST" },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Stop heartbeat run failed (HTTP ${res.status})`,
          };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Stop heartbeat run request failed",
        };
      }
    },

    async heartbeatNextRun(): Promise<HeartbeatNextRunResult> {
      const wsId = untrack(deps.activeWorkspaceId);
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(wsId)}/heartbeat/next-run`,
        );
        if (!res.ok) {
          // 404 = the backend hasn't shipped CR-HB-3 yet → the FE falls back to
          // an approximation. Surface as ok:false (non-fatal).
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Heartbeat next-run failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json().catch(() => null)) as { nextRunAt?: string | null } | null;
        // `null` (disabled / no run scheduled) passes through; anything non-string
        // also becomes null so a malformed body can't crash the countdown.
        const raw = data?.nextRunAt;
        const nextRunAt = typeof raw === "string" ? raw : null;
        return { ok: true, nextRunAt };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Heartbeat next-run request failed",
        };
      }
    },
    async concurrencyLimits(): Promise<ConcurrencyLimitsResult> {
      try {
        const res = await fetchImpl(`${httpBase}/concurrency/limits`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Concurrency limits failed (HTTP ${res.status})`,
          };
        }
        // Normalize the untyped JSON at the network seam (pure helper) so a
        // malformed/partial response (e.g. the extension returning `{}`) can
        // never crash the renderer.
        const limits = normalizeConcurrencyLimits(await res.json());
        return { ok: true, limits };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Concurrency limits request failed",
        };
      }
    },

    async getConcurrencyLimit(providerId: string): Promise<ConcurrencyLimitResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/concurrency/limits/${encodeURIComponent(providerId)}`,
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Concurrency limit failed (HTTP ${res.status})`,
          };
        }
        const limit = normalizeConcurrencyLimit(await res.json());
        if (limit === null) {
          return { ok: false, error: "Malformed concurrency limit response" };
        }
        return { ok: true, providerId: limit.providerId, limit: limit.limit };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Concurrency limit request failed",
        };
      }
    },

    async setConcurrencyLimit(providerId: string, limit: number): Promise<ConcurrencyLimitResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/concurrency/limits/${encodeURIComponent(providerId)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit }),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set concurrency limit failed (HTTP ${res.status})`,
          };
        }
        const echoed = normalizeConcurrencyLimit(await res.json());
        if (echoed === null) {
          return { ok: false, error: "Malformed concurrency limit response" };
        }
        return { ok: true, providerId: echoed.providerId, limit: echoed.limit };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set concurrency limit request failed",
        };
      }
    },

    async deleteConcurrencyLimit(providerId: string): Promise<ConcurrencyDeleteResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/concurrency/limits/${encodeURIComponent(providerId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Delete concurrency limit failed (HTTP ${res.status})`,
          };
        }
        return { ok: true, providerId };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Delete concurrency limit request failed",
        };
      }
    },

    async accountUsage(opts?: { readonly refresh?: boolean }): Promise<AccountUsageResult> {
      try {
        const res = await fetchImpl(`${httpBase}/usage${opts?.refresh ? "?refresh=1" : ""}`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Account usage failed (HTTP ${res.status})`,
            ...(res.status === 503 ? { unavailable: true } : {}),
          };
        }
        return { ok: true, usage: normalizeAccountUsage(await res.json(), Date.now()) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Account usage request failed",
        };
      }
    },

    async setAccountUsageSettings(
      provider: AccountUsageProviderId,
      settings: UpdateAccountUsageSettingsRequest,
    ): Promise<AccountUsageSettingsResult> {
      try {
        const res = await fetchImpl(`${httpBase}/usage/${encodeURIComponent(provider)}/settings`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Save usage settings failed (HTTP ${res.status})`,
          };
        }
        const report = normalizeAccountUsageReport(await res.json());
        return report
          ? { ok: true, report }
          : { ok: false, error: "Malformed usage settings response" };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Save usage settings request failed",
        };
      }
    },

    async concurrencyStatus(): Promise<ConcurrencyStatusResult> {
      try {
        const res = await fetchImpl(`${httpBase}/concurrency/status`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Concurrency status failed (HTTP ${res.status})`,
          };
        }
        const providers = normalizeConcurrencyStatus(await res.json());
        return { ok: true, providers };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Concurrency status request failed",
        };
      }
    },

    async searchBackendConfig(): Promise<SearchBackendConfigResult> {
      try {
        const res = await fetchImpl(`${httpBase}/search/config`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Search config failed (HTTP ${res.status})`,
            // The 503 degrade = the backend's search-config service not loaded
            // (the tool-web-search extension absent) — a distinct UI state.
            ...(res.status === 503 ? { unavailable: true } : {}),
          };
        }
        // Normalize the untyped JSON at this network seam (pure helper) so a
        // malformed/partial response can never crash the renderer.
        const config = normalizeSearchBackendConfig(await res.json());
        return { ok: true, config };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Search config request failed",
        };
      }
    },

    async setSearchBackend(backend: string): Promise<SearchBackendConfigResult> {
      try {
        const res = await fetchImpl(`${httpBase}/search/config`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backend }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set search backend failed (HTTP ${res.status})`,
            ...(res.status === 503 ? { unavailable: true } : {}),
          };
        }
        const config = normalizeSearchBackendConfig(await res.json());
        return { ok: true, config };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set search backend request failed",
        };
      }
    },

    async getConcurrencyCooldown(providerId: string): Promise<ConcurrencyCooldownResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/concurrency/cooldown/${encodeURIComponent(providerId)}`,
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Get concurrency cooldown failed (HTTP ${res.status})`,
          };
        }
        const data = normalizeConcurrencyCooldown(await res.json());
        if (data === null) {
          return { ok: false, error: "Malformed concurrency cooldown response" };
        }
        return { ok: true, providerId: data.providerId, cooldownMs: data.cooldownMs };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Get concurrency cooldown request failed",
        };
      }
    },

    async setConcurrencyCooldown(
      providerId: string,
      cooldownMs: number,
    ): Promise<ConcurrencyCooldownResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/concurrency/cooldown/${encodeURIComponent(providerId)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cooldownMs }),
          },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set concurrency cooldown failed (HTTP ${res.status})`,
          };
        }
        const data = normalizeConcurrencyCooldown(await res.json());
        if (data === null) {
          return { ok: false, error: "Malformed concurrency cooldown response" };
        }
        return { ok: true, providerId: data.providerId, cooldownMs: data.cooldownMs };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set concurrency cooldown request failed",
        };
      }
    },

    async loadSystemPrompt(): Promise<SystemPromptLoadResult> {
      try {
        const res = await fetchImpl(`${httpBase}/system-prompt`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Load system prompt failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as SystemPromptTemplateResponse;
        return { ok: true, template: data.template ?? "" };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Load system prompt request failed",
        };
      }
    },

    async setSystemPrompt(template: string): Promise<SystemPromptSaveResult> {
      try {
        const body: SetSystemPromptTemplateRequest = { template };
        const res = await fetchImpl(`${httpBase}/system-prompt`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Set system prompt failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as SystemPromptTemplateResponse;
        return { ok: true, template: data.template };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set system prompt request failed",
        };
      }
    },

    async loadSystemPromptVariables(): Promise<SystemPromptVariablesResult> {
      try {
        const res = await fetchImpl(`${httpBase}/system-prompt/variables`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Load system prompt variables failed (HTTP ${res.status})`,
          };
        }
        const data = (await res.json()) as Partial<SystemPromptVariablesResponse>;
        return { ok: true, variables: Array.isArray(data.variables) ? data.variables : [] };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Load system prompt variables request failed",
        };
      }
    },
  };
}
