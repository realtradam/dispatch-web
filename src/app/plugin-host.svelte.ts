/**
 * The frontend-plugin HOST wiring (plan 03 §3.2) — the composition-root glue
 * between the ABI driver (`core/plugin-abi`), the view registry, the
 * surfaces ports, and the plugins HTTP edge.
 *
 * The sync triggers (boot, `extensions-changed`, `workspace.set` → the app
 * store calls `sync()` on exactly those events) each fetch the plugin list +
 * the ACTIVE workspace's enablement rows, derive the desired candidate set
 * (pure), and run one driver pass. The driver's effects are injected HERE at
 * the edge:
 * - `importModule` — the dynamic `import()` (the only module-system touch);
 * - `buildHostApi` — the per-plugin `FrontendHostAPI` with FORCED pluginId
 *   attribution into the layout registry, app-store-backed surfaces ports,
 *   and a plugin-prefixed logger;
 * - `unregisterViewsByPlugin` — the registry's unload sweep.
 *
 * After every pass the per-plugin FE states are reported to the plugins
 * store (the manager UI renders "incompatible frontend plugin" and
 * activation failures).
 */
import {
  createFrontendDriver,
  FRONTEND_ABI_VERSION,
  type FrontendDriver,
  type FrontendHostAPI,
  type FrontendPluginState,
  frontendCandidates,
  usablePluginIds,
} from "../core/plugin-abi";
import {
  registerPluginView,
  unregisterViewsByPlugin,
  type ViewComponent,
} from "../features/layout";
import type { PluginsHttp } from "../features/plugins";

/** The surfaces ports the ABI hands plugin views — backed by the app store. */
export interface FrontendSurfacesPorts {
  readonly subscribe: (surfaceId: string, conversationId?: string) => void;
  readonly unsubscribe: (surfaceId: string, conversationId?: string) => void;
  readonly invoke: (
    surfaceId: string,
    actionId: string,
    payload?: unknown,
    conversationId?: string,
  ) => void;
  readonly getSpec: (surfaceId: string) => unknown;
}

/** The shape of the plugins store the FE states are reported to. */
export interface FrontendStateReporter {
  setFrontendStates(states: ReadonlyMap<string, FrontendPluginState>): void;
}

export interface PluginHostOptions {
  readonly http: PluginsHttp;
  /** The backend HTTP base (import-URL origin). */
  readonly httpBase: string;
  readonly reporter: FrontendStateReporter;
  /** The ACTIVE workspace provider (read per sync — workspace.set trigger). */
  readonly activeWorkspaceId: () => string;
  readonly surfaces: FrontendSurfacesPorts;
}

export interface PluginHost {
  /**
   * Run one sync pass (all three triggers share it — the active workspace
   * is read per call, which is what makes `workspace.set` a distinct
   * trigger). Never throws: a failed list fetch keeps the current set.
   */
  sync(): Promise<void>;
}

export function createPluginHost(opts: PluginHostOptions): PluginHost {
  const driver: FrontendDriver = createFrontendDriver({
    importModule: (url) => import(/* @vite-ignore */ url),
    buildHostApi: (pluginId) => buildHostApi(pluginId),
    unregisterViewsByPlugin,
    logger: console,
  });

  function buildHostApi(pluginId: string): FrontendHostAPI {
    return {
      abiVersion: FRONTEND_ABI_VERSION,
      registerView: (reg) =>
        registerPluginView(
          {
            id: reg.id,
            label: reg.label,
            // ONE controlled cast at the ABI seam — the registry is a
            // heterogeneous component bag (register-views.ts precedent);
            // the plugin's own build already vetted its component.
            component: reg.component as ViewComponent,
            ...(reg.panelEligible !== undefined ? { panelEligible: reg.panelEligible } : {}),
          },
          pluginId,
        ),
      surfaces: {
        subscribe: (surfaceId, conversationId) =>
          opts.surfaces.subscribe(surfaceId, conversationId),
        unsubscribe: (surfaceId, conversationId) =>
          opts.surfaces.unsubscribe(surfaceId, conversationId),
        invoke: (surfaceId, actionId, payload, conversationId) =>
          opts.surfaces.invoke(surfaceId, actionId, payload, conversationId),
        getSpec: (surfaceId) => opts.surfaces.getSpec(surfaceId) as never,
      },
      logger: {
        info: (msg) => console.info(`[frontend-plugin:${pluginId}] ${msg}`),
        warn: (msg) => console.warn(`[frontend-plugin:${pluginId}] ${msg}`),
      },
    };
  }

  return {
    async sync(): Promise<void> {
      // Both reads are fail-soft (null on network failure) — a down backend
      // keeps the CURRENT imported set untouched (no unload on a flaky
      // fetch, and the manager UI's last-known states persist).
      const workspaceId = opts.activeWorkspaceId();
      const [list, workspace] = await Promise.all([
        opts.http.list(),
        opts.http.workspacePlugins(workspaceId),
      ]);
      if (list === null) return;
      const candidates = frontendCandidates(list, {
        workspaceId,
        usableIds: usablePluginIds(workspace?.plugins ?? []),
        httpBase: opts.httpBase,
      });
      await driver.sync(candidates);
      opts.reporter.setFrontendStates(driver.states());
    },
  };
}
