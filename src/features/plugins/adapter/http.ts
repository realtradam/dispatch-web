import type {
  PluginListResponse,
  PluginOpResponse,
  PluginScanResponse,
  SetWorkspacePluginStateBlocked,
  SetWorkspacePluginStateRequest,
  SetWorkspacePluginStateResponse,
  WorkspacePluginProvidersStatusResponse,
  WorkspacePluginsResponse,
} from "@dispatch/transport-contract";

/**
 * Plugin HTTP effects — the injected edge that talks to the backend's plugin
 * manager routes (plan 05) + per-workspace enablement routes (plan 06 §6.6).
 * Mirrors the workspaces adapter's pattern: `httpBase` + an injected
 * `fetchImpl` (testable without the network); reads return data or a safe
 * `null` on failure (non-fatal), mutations return a typed result so a caller
 * can surface the backend's `{ reason, message }` block.
 *
 * Endpoints:
 * - `GET /plugins` → {@link PluginListResponse} (the two manager tables + missing strip)
 * - `POST /plugins/scan` → {@link PluginScanResponse} (manual scan; never auto-loads)
 * - `POST /plugins/:id/load` → {@link PluginOpResponse}
 * - `POST /plugins/:id/unload` body `{ force }` → {@link PluginOpResponse}
 * - `POST /plugins/:id/reload` → {@link PluginOpResponse}
 * - `GET /workspaces/:id/plugins` → {@link WorkspacePluginsResponse} (READ triggers
 *   read-through materialization)
 * - `PUT /workspaces/:id/plugins/:pluginId` body `{ state }` →
 *   {@link SetWorkspacePluginStateResponse} (409 `core-locked` / `unloaded`)
 * - `GET /workspaces/:id/plugins/providers-status` →
 *   {@link WorkspacePluginProvidersStatusResponse} (zero-enabled-providers guardrail)
 */

/** Outcome of a plugin-manager mutation (load / unload / reload). */
export type PluginOpResult =
  | { readonly ok: true; readonly response: Extract<PluginOpResponse, { ok: true }> }
  | {
      readonly ok: false;
      readonly error: string;
      readonly reason?: string;
      /** For `cascade-needs-force`: the loaded dependents a force would remove. */
      readonly dependents?: readonly string[];
    };

/** Outcome of a per-workspace state write (`PUT .../plugins/:pluginId`). */
export type WorkspaceStateResult =
  | { readonly ok: true; readonly response: SetWorkspacePluginStateResponse }
  | { readonly ok: false; readonly error: string; readonly reason?: string };

/** Outcome of the manual scan (`POST /plugins/scan`). */
export type PluginScanResult =
  | { readonly ok: true; readonly response: PluginScanResponse }
  | { readonly ok: false; readonly error: string };

export interface PluginsHttp {
  list(): Promise<PluginListResponse | null>;
  scan(): Promise<PluginScanResult>;
  load(id: string): Promise<PluginOpResult>;
  unload(id: string, force: boolean): Promise<PluginOpResult>;
  reload(id: string): Promise<PluginOpResult>;
  /** Read one workspace's effective plugin states (triggers materialization). */
  workspacePlugins(workspaceId: string): Promise<WorkspacePluginsResponse | null>;
  setWorkspaceState(
    workspaceId: string,
    pluginId: string,
    state: "enabled" | "disabled" | "unset",
  ): Promise<WorkspaceStateResult>;
  /** The zero-enabled-providers signal for the active workspace (§6.5). */
  providersStatus(workspaceId: string): Promise<WorkspacePluginProvidersStatusResponse | null>;
}

async function errorBody(res: Response): Promise<{
  error?: string;
  reason?: string;
  dependents?: readonly string[];
  message?: string;
}> {
  try {
    return (await res.json()) as {
      error?: string;
      reason?: string;
      dependents?: readonly string[];
      message?: string;
    };
  } catch {
    return {};
  }
}

/**
 * Map a plugin-manager block/error response to a `PluginOpResult`. The
 * backend's blocked shape is `{ ok: false, reason, message, dependents? }`;
 * other failures degrade to `{ error }` only.
 */
async function opResult(res: Response): Promise<PluginOpResult> {
  const body = await errorBody(res);
  const message = body.message ?? body.error ?? `HTTP ${res.status}`;
  return {
    ok: false,
    error: message,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.dependents !== undefined ? { dependents: body.dependents } : {}),
  };
}

export function createPluginsHttp(httpBase: string, fetchImpl: typeof fetch): PluginsHttp {
  const post = (path: string, body?: unknown): Promise<Response> =>
    fetchImpl(`${httpBase}${path}`, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });

  return {
    async list(): Promise<PluginListResponse | null> {
      try {
        const res = await fetchImpl(`${httpBase}/plugins`);
        if (!res.ok) return null;
        return (await res.json()) as PluginListResponse;
      } catch {
        return null;
      }
    },

    async scan(): Promise<PluginScanResult> {
      try {
        const res = await post("/plugins/scan");
        if (!res.ok)
          return { ok: false, error: (await errorBody(res)).error ?? `HTTP ${res.status}` };
        return { ok: true, response: (await res.json()) as PluginScanResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Scan request failed" };
      }
    },

    async load(id): Promise<PluginOpResult> {
      try {
        const res = await post(`/plugins/${encodeURIComponent(id)}/load`);
        if (!res.ok) return await opResult(res);
        return {
          ok: true,
          response: (await res.json()) as Extract<PluginOpResponse, { ok: true }>,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Load request failed" };
      }
    },

    async unload(id, force): Promise<PluginOpResult> {
      try {
        const res = await post(`/plugins/${encodeURIComponent(id)}/unload`, { force });
        if (!res.ok) return await opResult(res);
        return {
          ok: true,
          response: (await res.json()) as Extract<PluginOpResponse, { ok: true }>,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Unload request failed" };
      }
    },

    async reload(id): Promise<PluginOpResult> {
      try {
        const res = await post(`/plugins/${encodeURIComponent(id)}/reload`);
        if (!res.ok) return await opResult(res);
        return {
          ok: true,
          response: (await res.json()) as Extract<PluginOpResponse, { ok: true }>,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Reload request failed" };
      }
    },

    async workspacePlugins(workspaceId): Promise<WorkspacePluginsResponse | null> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/plugins`,
        );
        if (!res.ok) return null;
        return (await res.json()) as WorkspacePluginsResponse;
      } catch {
        return null;
      }
    },

    async setWorkspaceState(workspaceId, pluginId, state): Promise<WorkspaceStateResult> {
      const body: SetWorkspacePluginStateRequest = { state };
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(pluginId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const blocked = (await errorBody(res)) as Partial<SetWorkspacePluginStateBlocked> & {
            error?: string;
          };
          return {
            ok: false,
            error: blocked.message ?? blocked.error ?? `HTTP ${res.status}`,
            ...(blocked.reason !== undefined ? { reason: blocked.reason } : {}),
          };
        }
        return { ok: true, response: (await res.json()) as SetWorkspacePluginStateResponse };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set plugin state request failed",
        };
      }
    },

    async providersStatus(workspaceId): Promise<WorkspacePluginProvidersStatusResponse | null> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/plugins/providers-status`,
        );
        if (!res.ok) return null;
        return (await res.json()) as WorkspacePluginProvidersStatusResponse;
      } catch {
        return null;
      }
    },
  };
}
