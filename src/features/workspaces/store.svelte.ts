import type { EnsureWorkspaceRequest } from "@dispatch/transport-contract";
import type { Workspace, WorkspaceEntry } from "@dispatch/wire";
import type { WorkspaceHttp, WorkspaceResult } from "./adapter/http";
import { applyStarred, sortWorkspaces } from "./logic/view-model";

/**
 * Workspace store — a thin reactive wrapper over the pure HTTP edge. Owns the
 * list + loading/error state; mutations call the injected `WorkspaceHttp` and
 * refresh the list. State is per-instance (no ambient store); subscriptions are
 * owned by the composition root.
 */
export interface WorkspaceStore {
  /**
   * All workspaces, sorted for display: starred first (their FE-side echo of
   * concurrency-priority), then most-recently-active. The backing list is the
   * backend's `lastActivityAt`-desc order; this getter re-sorts reactively.
   */
  readonly list: readonly WorkspaceEntry[];
  readonly loading: boolean;
  readonly error: string | null;
  /** Refresh the list from the backend. */
  refresh(): Promise<void>;
  /** `PUT /workspaces/:id` (create-on-miss). Returns the workspace or an error. */
  ensure(id: string, body?: EnsureWorkspaceRequest): Promise<WorkspaceResult<Workspace>>;
  /** Rename a workspace (display only; id unchanged). */
  rename(id: string, title: string): Promise<WorkspaceResult<Workspace>>;
  /** Set/clear a workspace's default cwd. */
  setDefaultCwd(id: string, defaultCwd: string | null): Promise<WorkspaceResult<Workspace>>;
  /** Set/clear a workspace's default computer (SSH `Host` alias; null = local). */
  setDefaultComputer(id: string, computerId: string | null): Promise<WorkspaceResult<Workspace>>;
  /**
   * Toggle a workspace's star (concurrency priority). Optimistic: the local
   * `starred` flag flips immediately and the sorted list re-orders; on error it
   * reverts to the prior value. No full refresh on success (avoids flicker).
   */
  setStarred(id: string, starred: boolean): Promise<WorkspaceResult<Workspace>>;
  /** Delete a workspace (closes its conversations, reassigns to "default"). */
  remove(id: string): Promise<WorkspaceResult<{ closedCount: number }>>;
}

export function createWorkspaceStore(http: WorkspaceHttp): WorkspaceStore {
  let list = $state<readonly WorkspaceEntry[]>([]);
  // Sorted view (starred first, then most-recent) — derived so it recomputes
  // only when the backing list changes, not on every read.
  let sorted = $derived(sortWorkspaces(list));
  let loading = $state(false);
  let error = $state<string | null>(null);

  return {
    get list(): readonly WorkspaceEntry[] {
      return sorted;
    },
    get loading(): boolean {
      return loading;
    },
    get error(): string | null {
      return error;
    },

    async refresh(): Promise<void> {
      loading = true;
      error = null;
      try {
        list = await http.list();
      } catch (err) {
        error = err instanceof Error ? err.message : "Failed to load workspaces";
      } finally {
        loading = false;
      }
    },

    async ensure(id, body): Promise<WorkspaceResult<Workspace>> {
      const result = await http.ensure(id, body);
      if (result.ok) void this.refresh();
      return result;
    },

    async rename(id, title): Promise<WorkspaceResult<Workspace>> {
      const result = await http.setTitle(id, title);
      if (result.ok) void this.refresh();
      return result;
    },

    async setDefaultCwd(id, defaultCwd): Promise<WorkspaceResult<Workspace>> {
      const result = await http.setDefaultCwd(id, defaultCwd);
      if (result.ok) void this.refresh();
      return result;
    },

    async setDefaultComputer(id, computerId): Promise<WorkspaceResult<Workspace>> {
      const result = await http.setDefaultComputer(id, computerId);
      if (result.ok) void this.refresh();
      return result;
    },

    async setStarred(id, starred): Promise<WorkspaceResult<Workspace>> {
      const prev = list.find((w) => w.id === id)?.starred ?? false;
      // Optimistic: flip immediately (the sorted getter re-orders reactively).
      list = applyStarred(list, id, starred);
      const result = starred ? await http.star(id) : await http.unstar(id);
      if (!result.ok) {
        // Revert the optimistic flip on failure.
        list = applyStarred(list, id, prev);
      }
      return result;
    },

    async remove(id): Promise<WorkspaceResult<{ closedCount: number }>> {
      const result = await http.delete(id);
      if (result.ok) void this.refresh();
      return result;
    },
  };
}
