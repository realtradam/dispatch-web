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

/**
 * Workspace HTTP effects — the injected edge that talks to the backend's
 * workspace endpoints. Mirrors the store's fetch pattern: `httpBase` + an
 * injected `fetchImpl` (so it is testable without the network). Returns typed
 * `WorkspaceResult<T>` (`{ok,value}` | `{ok:false,error}`) for mutating ops so a
 * caller can surface the backend's `{ error }` reason; reads return data or a
 * safe empty/null on failure (non-fatal — the UI falls back gracefully).
 *
 * Endpoints (transport-contract@0.16.0):
 * - `GET /workspaces` → list
 * - `PUT /workspaces/:id` (create-on-miss, idempotent) → ensure
 * - `GET /workspaces/:id` (404 → null) → get
 * - `PUT /workspaces/:id/title` → rename
 * - `PUT /workspaces/:id/default-cwd` → set/clear default cwd
 * - `PUT /workspaces/:id/default-computer` → set/clear default computer (SSH handoff #2)
 * - `DELETE /workspaces/:id` (409 for "default") → delete
 */
export type WorkspaceResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: string };

export interface WorkspaceHttp {
	list(): Promise<readonly WorkspaceEntry[]>;
	ensure(id: string, body?: EnsureWorkspaceRequest): Promise<WorkspaceResult<Workspace>>;
	get(id: string): Promise<Workspace | null>;
	setTitle(id: string, title: string): Promise<WorkspaceResult<Workspace>>;
	setDefaultCwd(id: string, defaultCwd: string | null): Promise<WorkspaceResult<Workspace>>;
	setDefaultComputer(id: string, computerId: string | null): Promise<WorkspaceResult<Workspace>>;
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
		async list(): Promise<readonly WorkspaceEntry[]> {
			try {
				const res = await fetchImpl(`${httpBase}/workspaces`);
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

		async get(id): Promise<Workspace | null> {
			try {
				const res = await fetchImpl(`${httpBase}/workspaces/${encodeURIComponent(id)}`);
				if (res.status === 404 || !res.ok) return null;
				return (await res.json()) as WorkspaceResponse;
			} catch {
				return null;
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
