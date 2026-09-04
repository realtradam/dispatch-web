import type {
  PluginListResponse,
  SetWorkspacePluginStateRequest,
  WorkspacePluginRow,
} from "@dispatch/transport-contract";
import type { FrontendPluginState } from "../../core/plugin-abi";
import type { PluginOpResult, PluginScanResult, PluginsHttp } from "./adapter/http";
import type { PluginNode } from "./logic/types";
import { pluginNodes } from "./logic/view-model";

/**
 * Plugins store — a thin reactive wrapper over the injected `PluginsHttp`
 * edge (the workspaces-store pattern). Owns:
 * - the manager's plugin list (`GET /plugins`) normalized to `PluginNode`s;
 * - ONE open workspace modal's view (`GET /workspaces/:id/plugins` — read-through
 *   materialization makes this first read the workspace's "open");
 * - pending/error state for the mutations.
 *
 * Multi-client coherence (§11): the composition root calls
 * `onExtensionsChanged()` when the server broadcasts `extensions-changed` —
 * the store refetches the list (and the open workspace view), so every
 * connected client converges. No ambient state: one instance per composition
 * root, passed explicitly; no module-level mutables.
 */
export interface PluginsStore {
  /** The last `GET /plugins` response (null until the first fetch lands). */
  readonly list: PluginListResponse | null;
  /** The normalized nodes across ALL sections (loaded + discovered + missing). */
  readonly nodes: readonly PluginNode[];
  readonly loading: boolean;
  /** The last mutation/scan/load error message, or null. */
  readonly error: string | null;
  /** The manual scan's result (null until a scan ran), for the summary line. */
  readonly lastScan: PluginScanResult | null;

  /** Refetch `GET /plugins`. */
  refresh(): Promise<void>;
  /** `POST /plugins/scan` (manual; the server never auto-loads new plugins). */
  scan(): Promise<PluginScanResult>;
  /** `POST /plugins/:id/load`. */
  load(id: string): Promise<PluginOpResult>;
  /** `POST /plugins/:id/unload` with `{ force }` (the §8 force semantics). */
  unload(id: string, force: boolean): Promise<PluginOpResult>;
  /** `POST /plugins/:id/reload`. */
  reload(id: string): Promise<PluginOpResult>;

  /**
   * The open workspace modal's rows (null when nothing loaded yet). Cleared
   * IMMEDIATELY on open so a slow/failing fetch never shows the previous
   * workspace's rows (the refreshCwd/refreshComputer pattern).
   */
  readonly workspaceView: WorkspacePluginsView | null;
  /** Load/reload the workspace modal's view (`GET /workspaces/:id/plugins`). */
  openWorkspace(workspaceId: string): Promise<void>;
  /**
   * Write one plugin's state in one workspace (`PUT .../plugins/:pluginId`).
   * On success the open view's row is updated in place from the response; on
   * failure the error is surfaced AND the view refetched (server-authoritative
   * reconciliation — the checkbox never lies).
   */
  setWorkspaceState(
    workspaceId: string,
    pluginId: string,
    state: SetWorkspacePluginStateRequest["state"],
  ): Promise<void>;

  /**
   * Multi-client coherence hook (§11): the composition root calls
   * `onExtensionsChanged()` when the server broadcasts `extensions-changed` —
   * the store refetches the list (and the open workspace view), so every
   * connected client converges. Fire-and-forget.
   */
  onExtensionsChanged(): void;

  /**
   * The frontend-plugin (plan 03) per-plugin FE states — reported by the
   * plugin host after every driver sync. Rendered by the manager rows:
   * `incompatible` → "incompatible frontend plugin" (the backend-mismatch
   * grammar), `failed` → the activation error. Absent = no FE section.
   */
  readonly frontendStates: ReadonlyMap<string, FrontendPluginState>;
  /** The plugin host's post-sync report (the only writer). */
  setFrontendStates(states: ReadonlyMap<string, FrontendPluginState>): void;
}

/** One open workspace modal's view (rows + materialized provider count). */
export interface WorkspacePluginsView {
  readonly workspaceId: string;
  readonly rows: readonly WorkspacePluginRow[];
  /** Loaded provider-tier plugins effectively enabled here (§6.5). */
  readonly enabledProviderCount: number;
}

export function createPluginsStore(http: PluginsHttp): PluginsStore {
  let list = $state<PluginListResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let lastScan = $state<PluginScanResult | null>(null);
  let workspaceView = $state<WorkspacePluginsView | null>(null);
  let frontendStates = $state<ReadonlyMap<string, FrontendPluginState>>(new Map());

  // Normalized nodes — derived so the graph logic re-runs only when the list
  // changes, not on every read.
  const nodes = $derived<readonly PluginNode[]>(list === null ? [] : pluginNodes(list));

  return {
    get list(): PluginListResponse | null {
      return list;
    },
    get nodes(): readonly PluginNode[] {
      return nodes;
    },
    get loading(): boolean {
      return loading;
    },
    get error(): string | null {
      return error;
    },
    get lastScan(): PluginScanResult | null {
      return lastScan;
    },
    get workspaceView(): WorkspacePluginsView | null {
      return workspaceView;
    },

    async refresh(): Promise<void> {
      loading = true;
      const data = await http.list();
      if (data !== null) list = data;
      loading = false;
    },

    async scan(): Promise<PluginScanResult> {
      error = null;
      const result = await http.scan();
      lastScan = result;
      if (!result.ok) error = result.error;
      // A scan broadcasts `extensions-changed` server-side; refresh anyway so
      // the manager is coherent even without a WS connection.
      await this.refresh();
      return result;
    },

    async load(id): Promise<PluginOpResult> {
      error = null;
      const result = await http.load(id);
      if (!result.ok) error = result.error;
      await this.refresh();
      return result;
    },

    async unload(id, force): Promise<PluginOpResult> {
      error = null;
      const result = await http.unload(id, force);
      if (!result.ok) error = result.error;
      await this.refresh();
      return result;
    },

    async reload(id): Promise<PluginOpResult> {
      error = null;
      const result = await http.reload(id);
      if (!result.ok) error = result.error;
      await this.refresh();
      return result;
    },

    async openWorkspace(workspaceId): Promise<void> {
      // Clear immediately so a slow/failing fetch never shows the PREVIOUS
      // workspace's rows in the new modal.
      workspaceView = null;
      const data = await http.workspacePlugins(workspaceId);
      if (data === null) {
        error = `Failed to load plugins for workspace "${workspaceId}"`;
        return;
      }
      workspaceView = {
        workspaceId: data.workspaceId,
        rows: data.plugins,
        enabledProviderCount: data.enabledProviderCount,
      };
    },

    async setWorkspaceState(workspaceId, pluginId, state): Promise<void> {
      const result = await http.setWorkspaceState(workspaceId, pluginId, state);
      if (result.ok) {
        // Server-authoritative in-place row update (the response carries the
        // resulting effective state — "undefined" after "unset").
        if (workspaceView?.workspaceId === workspaceId) {
          const rows = workspaceView.rows.map(
            (row): WorkspacePluginRow =>
              row.pluginId === pluginId ? { ...row, state: result.response.state } : row,
          );
          workspaceView = { ...workspaceView, rows };
        }
        return;
      }
      error = result.error;
      // Refusal (409 core-locked / unloaded) or failure — reconcile from the
      // server so the checkbox never lies.
      await this.openWorkspace(workspaceId);
    },

    onExtensionsChanged(): void {
      void this.refresh();
      const open = workspaceView?.workspaceId;
      if (open !== undefined) void this.openWorkspace(open);
    },

    get frontendStates(): ReadonlyMap<string, FrontendPluginState> {
      return frontendStates;
    },

    setFrontendStates(states: ReadonlyMap<string, FrontendPluginState>): void {
      frontendStates = states;
    },
  };
}
