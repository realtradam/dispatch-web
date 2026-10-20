import type {
  ComputerListResponse,
  ModelMetadata,
  ModelsResponse,
} from "@dispatch/transport-contract";
import type { ComputerEntry } from "@dispatch/wire";
import type {
  NamedAgent,
  NamedAgentDeleteResult,
  NamedAgentInput,
  NamedAgentSaveResult,
  NamedAgentsResult,
} from "../features/named-agents";
import { normalizeNamedAgentRecord, normalizeNamedAgents } from "../features/named-agents";

/** Replace-or-append a Named Agent into a list (immutably), keyed by id. */
function upsertNamedAgentList(
  agents: readonly NamedAgent[],
  agent: NamedAgent,
): readonly NamedAgent[] {
  const idx = agents.findIndex((a) => a.id === agent.id);
  if (idx === -1) return [...agents, agent];
  return agents.map((a) => (a.id === agent.id ? agent : a));
}

/** Workspace catalogs, global settings discovery and Named Agent records. */
export function createSettingsRefreshers(deps: {
  httpBase: string;
  fetchImpl: typeof fetch;
  activeWorkspaceId: () => string;
  reportError: (context: string, err: unknown) => void;
}) {
  const { httpBase, fetchImpl } = deps;
  let models = $state<readonly string[]>([]);
  let modelInfo = $state<Readonly<Record<string, ModelMetadata>>>({});
  // Discovered SSH computers (`GET /computers`). Global (like `models`); empty
  // until the `ssh` extension lands. Read-only — no CRUD (the user edits their
  // `~/.ssh/config`).
  let computers = $state<readonly ComputerEntry[]>([]);
  // The persisted Named Agents (global user config). Seeded from the backend on
  // boot + kept in sync by the CRUD methods; drives both the sidebar editor and
  // the synthetic model-selector provider.
  let namedAgents = $state<readonly NamedAgent[]>([]);
  /**
   * Loaded provider-tier plugins effectively enabled in the ACTIVE workspace
   * (`GET /workspaces/:id/plugins/providers-status`, plan 06 §6.5). `null` =
   * unknown (not fetched yet / endpoint missing) — the first-boot guardrail
   * shows only on a confident `0` (§7).
   */
  let enabledProviderCount = $state<number | null>(null);

  /** Replace-or-append a Named Agent into the reactive list (immutably). */
  function upsertNamedAgent(agent: NamedAgent): void {
    namedAgents = upsertNamedAgentList(namedAgents, agent);
  }

  /**
   * Refetch the model catalog for the ACTIVE workspace
   * (`GET /models?workspaceId=`, plan 06 §6.5 — workspace-aware; a backend
   * without the param returns the global catalog, which stays correct).
   * Re-run on boot, on every workspace switch, and on `extensions-changed`
   * (a provider toggled in another client updates the picker here too).
   */
  async function refreshModels(): Promise<void> {
    try {
      const res = await fetchImpl(
        `${httpBase}/models?workspaceId=${encodeURIComponent(deps.activeWorkspaceId())}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as ModelsResponse;
      // Defensive: a malformed/SPA-fallback response must never poison the
      // picker with a non-array (the old boot chain had the same exposure).
      if (!Array.isArray(data.models)) return;
      models = data.models;
      modelInfo = data.modelInfo ?? {};
    } catch (err) {
      deps.reportError("Failed to load model list", err);
    }
  }

  /**
   * Refetch the active workspace's provider status (the §6.5 first-boot
   * guardrail signal). Guarded against a slow response losing a race with a
   * workspace switch (only the CURRENT workspace's result lands). Non-JSON
   * 200 (SPA fallback — endpoint not shipped) leaves it null (no prompt).
   */
  async function refreshProviderStatus(): Promise<void> {
    const workspaceId = deps.activeWorkspaceId();
    try {
      const res = await fetchImpl(
        `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/plugins/providers-status`,
      );
      if (!res.ok) {
        if (workspaceId === deps.activeWorkspaceId()) enabledProviderCount = null;
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return;
      const data = (await res.json()) as { enabledProviderCount?: number };
      if (workspaceId === deps.activeWorkspaceId()) {
        enabledProviderCount =
          typeof data.enabledProviderCount === "number" ? data.enabledProviderCount : null;
      }
    } catch {
      // Non-fatal: the guardrail just stays hidden (null) when the endpoint
      // is unreachable.
      if (workspaceId === deps.activeWorkspaceId()) enabledProviderCount = null;
    }
  }

  function loadGlobalCatalogs(): void {
    // Fetch the discovered-computer catalog (global, like models). Empty until
    // the `ssh` extension lands — a safe no-op until then (the selector shows
    // "Local (none)" only). Non-fatal: a failure leaves an empty list.
    void fetchImpl(`${httpBase}/computers`)
      .then((res) => {
        if (!res.ok) return { computers: [] } as ComputerListResponse;
        return res.json() as Promise<ComputerListResponse>;
      })
      .then((data) => {
        computers = data?.computers ?? [];
      })
      .catch((err) => {
        deps.reportError("Failed to load computer list", err);
      });

    // Fetch the persisted Named Agents (global user config). Seeded on boot so the
    // sidebar editor + the synthetic model-selector provider have data immediately.
    // Non-fatal: a failure leaves an empty list (the user can add agents).
    void fetchImpl(`${httpBase}/named-agents`)
      .then((res) => {
        if (!res.ok) return { namedAgents: [] } as { namedAgents: NamedAgent[] };
        return res.json() as Promise<{ namedAgents: NamedAgent[] }>;
      })
      .then((data) => {
        namedAgents = normalizeNamedAgents(data);
      })
      .catch((err) => {
        deps.reportError("Failed to load named agents", err);
      });
  }

  return {
    refreshModels,
    refreshProviderStatus,
    loadGlobalCatalogs,
    get models() {
      return models;
    },
    get modelInfo() {
      return modelInfo;
    },
    get computers() {
      return computers;
    },
    get namedAgents() {
      return namedAgents;
    },
    get enabledProviderCount() {
      return enabledProviderCount;
    },
    async refreshNamedAgents(): Promise<NamedAgentsResult> {
      try {
        const res = await fetchImpl(`${httpBase}/named-agents`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Named agents failed (HTTP ${res.status})`,
          };
        }
        const agents = normalizeNamedAgents(await res.json());
        namedAgents = agents;
        return { ok: true, agents };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Named agents request failed",
        };
      }
    },

    async createNamedAgent(input: NamedAgentInput): Promise<NamedAgentSaveResult> {
      try {
        const res = await fetchImpl(`${httpBase}/named-agents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Create named agent failed (HTTP ${res.status})`,
          };
        }
        const agent = normalizeNamedAgentRecord(await res.json());
        if (agent === null) return { ok: false, error: "Malformed named agent response" };
        upsertNamedAgent(agent);
        return { ok: true, agent };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Create named agent request failed",
        };
      }
    },

    async updateNamedAgent(id: string, input: NamedAgentInput): Promise<NamedAgentSaveResult> {
      try {
        const res = await fetchImpl(`${httpBase}/named-agents/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Update named agent failed (HTTP ${res.status})`,
          };
        }
        const agent = normalizeNamedAgentRecord(await res.json());
        if (agent === null) return { ok: false, error: "Malformed named agent response" };
        upsertNamedAgent(agent);
        return { ok: true, agent };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Update named agent request failed",
        };
      }
    },

    async deleteNamedAgent(id: string): Promise<NamedAgentDeleteResult> {
      try {
        const res = await fetchImpl(`${httpBase}/named-agents/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          return {
            ok: false,
            error: errBody?.error ?? `Delete named agent failed (HTTP ${res.status})`,
          };
        }
        namedAgents = namedAgents.filter((a) => a.id !== id);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Delete named agent request failed",
        };
      }
    },
  };
}
