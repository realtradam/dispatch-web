import type {
  DeleteWorkspaceResponse,
  EnsureWorkspaceRequest,
  SetWorkspaceDefaultComputerRequest,
  SetWorkspaceDefaultCwdRequest,
  SetWorkspaceTitleRequest,
  Workspace,
  WorkspaceEntry,
  WorkspaceListResponse,
  WorkspaceResponse,
} from "@dispatch/transport-contract";
import type { WorkspaceLookup } from "../logic/create";

/**
 * Workspace HTTP effects — the injected edge that talks to the backend's
 * workspace endpoints. Mirrors the store's fetch pattern: `httpBase` + an
 * injected `fetchImpl` (so it is testable without the network). Returns typed
 * `WorkspaceResult<T>` (`{ok,value}` | `{ok:false,error}`) for mutating ops so a
 * caller can surface the backend's `{ error }` reason; reads return data or a
 * safe empty/null on failure (non-fatal — the UI falls back gracefully).
 *
 * Endpoints (transport-contract@0.16.0):
 * - `GET /workspaces` (optional `?archived=true|false|all`, default `false` = active only) → list
 * - `PUT /workspaces/:id` (create-on-miss, idempotent) → ensure
 * - `GET /workspaces/:id` (found | 404-missing | failed) → get
 * - `PUT /workspaces/:id/title` → rename
 * - `PUT /workspaces/:id/default-cwd` → set/clear default cwd
 * - `PUT /workspaces/:id/default-computer` → set/clear default computer (SSH handoff #2)
 * - `PUT /workspaces/:id/star` (create-on-miss) → star (concurrency priority)
 * - `DELETE /workspaces/:id/star` (create-on-miss) → unstar
 * - `PUT /workspaces/:id/archive` (create-on-miss; 409 for "default") → archive (hide from home grid)
 * - `DELETE /workspaces/:id/archive` (create-on-miss; 409 for "default") → unarchive
 * - `DELETE /workspaces/:id` (409 for "default") → delete
 */
export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Which workspaces `GET /workspaces` returns: active-only (default), archived-only, or all. */
export type WorkspaceArchivedFilter = "true" | "false" | "all";

export interface WorkspaceHttp {
  list(archived?: WorkspaceArchivedFilter): Promise<readonly WorkspaceEntry[]>;
  ensure(id: string, body?: EnsureWorkspaceRequest): Promise<WorkspaceResult<Workspace>>;
  /**
   * Authoritative existence probe. 404 → `missing`, a network/server failure →
   * `failed` (distinct on purpose: the create gate must not treat a broken
   * check as "doesn't exist"), 200 → the workspace (`found`).
   */
  get(id: string): Promise<WorkspaceLookup>;
  setTitle(id: string, title: string): Promise<WorkspaceResult<Workspace>>;
  setDefaultCwd(id: string, defaultCwd: string | null): Promise<WorkspaceResult<Workspace>>;
  setDefaultComputer(id: string, computerId: string | null): Promise<WorkspaceResult<Workspace>>;
  /** Star a workspace (concurrency priority). Create-on-miss; no body. */
  star(id: string): Promise<WorkspaceResult<Workspace>>;
  /** Unstar a workspace. Create-on-miss; no body. */
  unstar(id: string): Promise<WorkspaceResult<Workspace>>;
  /** Archive a workspace (hide from the home grid; data untouched). Create-on-miss; no body. */
  archive(id: string): Promise<WorkspaceResult<Workspace>>;
  /** Unarchive a workspace (restore to the home grid). Create-on-miss; no body. */
  unarchive(id: string): Promise<WorkspaceResult<Workspace>>;
  delete(id: string): Promise<WorkspaceResult<{ closedCount: number }>>;
}

async function errText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function createWorkspaceHttp(httpBase: string, fetchImpl: typeof fetch): WorkspaceHttp {
  return {
    async list(archived?: WorkspaceArchivedFilter): Promise<readonly WorkspaceEntry[]> {
      try {
        const qs = archived !== undefined ? `?archived=${archived}` : "";
        const res = await fetchImpl(`${httpBase}/workspaces${qs}`);
        if (!res.ok) return [];
        const data = (await res.json()) as WorkspaceListResponse;
        return data.workspaces;
      } catch {
        return [];
      }
    },

    async ensure(id, body): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Workspace request failed",
        };
      }
    },

    async get(id): Promise<WorkspaceLookup> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}`);
        if (res.status === 404) return { kind: "missing" };
        if (!res.ok) return { kind: "failed", error: await errText(res) };
        return { kind: "found", workspace: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return {
          kind: "failed",
          error: err instanceof Error ? err.message : "Workspace lookup failed",
        };
      }
    },

    async setTitle(id, title): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}/title`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title } satisfies SetWorkspaceTitleRequest),
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Rename failed" };
      }
    },

    async setDefaultCwd(id, defaultCwd): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(id)}/default-cwd`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ defaultCwd } satisfies SetWorkspaceDefaultCwdRequest),
          },
        );
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Set default cwd failed" };
      }
    },

    async setDefaultComputer(id, computerId): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(id)}/default-computer`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ computerId } satisfies SetWorkspaceDefaultComputerRequest),
          },
        );
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Set default computer failed",
        };
      }
    },

    async star(id): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}/star`, {
          method: "PUT",
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Star failed" };
      }
    },

    async unstar(id): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}/star`, {
          method: "DELETE",
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Unstar failed" };
      }
    },

    async archive(id): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}/archive`, {
          method: "PUT",
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Archive failed" };
      }
    },

    async unarchive(id): Promise<WorkspaceResult<Workspace>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}/archive`, {
          method: "DELETE",
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        return { ok: true, value: (await res.json()) as WorkspaceResponse };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Unarchive failed" };
      }
    },

    async delete(id): Promise<WorkspaceResult<{ closedCount: number }>> {
      try {
        const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) return { ok: false, error: await errText(res) };
        const data = (await res.json()) as DeleteWorkspaceResponse;
        return { ok: true, value: { closedCount: data.closedCount } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
      }
    },
  };
}
