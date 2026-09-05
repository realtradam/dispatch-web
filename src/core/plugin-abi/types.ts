/**
 * The frontend plugin ABI surface (plan 03 §3.2) — the ONLY contract between
 * the host app and a dynamically-imported frontend plugin module.
 *
 * A frontend plugin is a SINGLE prebuilt ESM file (svelte externalized —
 * resolved through the host's import map to the app's own Svelte 5 runtime)
 * whose default export is `{ activate(api) }`. `activate` registers views /
 * stashes ports and MAY return a deactivate disposer (plan 03's deactivate
 * contract). Trust model: plugin code runs with full page privileges — no
 * sandbox (documented non-goal); the trust signal is the manifest's `trust`
 * field rendered in the manager UI.
 *
 * Views get data via SURFACES (the ui-contract philosophy: backend-declared
 * data rendered generically) — never via the app store. `registerView`
 * FORCES the importing plugin's pluginId attribution (the host wraps the
 * registry call), which is what makes unload-time sweeps exact.
 */
import type { ApplyOpsResult, LayoutOp, LayoutTree } from "@dispatch/layout-contract";
import type { SurfaceSpec } from "@dispatch/ui-contract";
import type { FRONTEND_ABI_VERSION } from "./version.js";

/** The registration input for one plugin view (as the ABI exposes it). */
export interface FrontendViewRegistration {
  /** Registry id — the same id a tile leaf's `view` field names. */
  readonly id: string;
  /** Human label shown in panel dropdowns. */
  readonly label: string;
  /**
   * A Svelte 5 component (compiled by the plugin's build against the SHARED
   * svelte runtime). Opaque here — the host casts it into the registry's
   * heterogeneous component bag at the seam.
   */
  readonly component: unknown;
  /** Whether the view may appear in panel dropdowns (default true). */
  readonly panelEligible?: boolean;
}

/** The per-plugin host API object handed to `activate`. */
export interface FrontendHostAPI {
  /** The host's ABI version (the other half of the semver handshake). */
  readonly abiVersion: typeof FRONTEND_ABI_VERSION;
  /**
   * Register a view into the SAME registry built-ins use. pluginId
   * attribution is FORCED to the importing plugin (the host closes over it)
   * — plugins cannot attribute views to another plugin. The returned
   * disposer removes the view (call it from your deactivate).
   */
  readonly registerView: (reg: FrontendViewRegistration) => () => void;
  /**
   * Talk to backend surfaces — the plugin-view data path. The app
   * auto-subscribes every catalog entry, so `getSpec` typically returns
   * data immediately for surfaces your plugin's backend half declares;
   * subscribe/unsubscribe re-assert scopes explicitly.
   */
  readonly surfaces: {
    readonly subscribe: (surfaceId: string, conversationId?: string) => void;
    readonly unsubscribe: (surfaceId: string, conversationId?: string) => void;
    readonly invoke: (
      surfaceId: string,
      actionId: string,
      payload?: unknown,
      conversationId?: string,
    ) => void;
    readonly getSpec: (surfaceId: string) => SurfaceSpec | null;
  };
  readonly logger: { info: (msg: string) => void; warn: (msg: string) => void };
  /**
   * Edit the ACTIVE workspace's layout through the provider (plan 04 §4.5 —
   * the additive ABI bump; v1 plugins keep working, a plugin REQUIRING the
   * layout member declares `frontend.apiVersion: "^1.1"`). A thin adapter
   * over `POST /workspaces/:id/layout/ops` (the same kit `applyOps` the
   * service exposes — one code path, two doors):
   * - the ops are the `@dispatch/layout-contract` vocabulary (prefer the
   *   idempotent `ensure*` ops; address by node ID, never by numeric path);
   * - the batch is ATOMIC — any failed op persists nothing and the result
   *   names it (`failedOp`);
   * - no layout provider active (the route 404s) → the typed no-provider
   *   error `{ ok: false, error: "no layout provider active" }` — handle it;
   *   the provider may also load later (retry on workspace switches).
   */
  readonly layout: {
    readonly applyOps: (ops: readonly LayoutOp[]) => Promise<ApplyOpsResult>;
    /** The ACTIVE workspace's tree; `null` in no-provider mode. */
    readonly getTree: () => LayoutTree | null;
  };
}

/**
 * What `activate` may return: nothing, or the deactivate disposer (the
 * plan-03 deactivate contract). A named alias keeps the plan grammar
 * readable; the suppression is needed because biome flags `void` inside a
 * union type — here it is the plan-specified shape.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: plan-specified activate grammar — "may return a disposer" (the deactivate contract)
export type FrontendActivateResult = void | (() => void);

/** The module shape a frontend plugin's entry must default-export. */
export interface FrontendPluginModule {
  readonly default: {
    /**
     * Register the plugin's views/ports. MAY return a deactivate disposer —
     * run on unload/disable BEFORE the host's unregister-by-pluginId sweep
     * (the sweep is the safety net, not the primary path).
     */
    activate(api: FrontendHostAPI): FrontendActivateResult;
  };
}

/** The per-plugin FRONTEND lifecycle state the manager UI renders. */
export type FrontendPluginState =
  | { readonly kind: "loaded" }
  | { readonly kind: "incompatible"; readonly apiVersion: string }
  | { readonly kind: "failed"; readonly error: string };
