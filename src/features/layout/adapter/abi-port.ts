import type { ApplyOpsResult, LayoutOp, LayoutTree } from "@dispatch/layout-contract";
import type { LayoutProviderState, LayoutStore } from "../store.svelte";

/**
 * The port the frontend-plugin ABI exposes as `api.layout` (plan 04 §4.5).
 * The composition root builds it with {@link createLayoutAbiPort} and the
 * plugin host hands it to every `activate(api)` — plugins never see the
 * store or the HTTP edge, only THIS.
 */
export interface LayoutAbiPort {
  /**
   * Apply op-vocabulary edits to the ACTIVE workspace's tree through the
   * provider (`POST /workspaces/:id/layout/ops`). Atomic; the no-provider
   * 404 maps to the typed `{ ok: false, error: "no layout provider active" }`.
   */
  readonly applyOps: (ops: readonly LayoutOp[]) => Promise<ApplyOpsResult>;
  /** The ACTIVE workspace's tree; `null` in no-provider mode. */
  readonly getTree: () => LayoutTree | null;
}

export interface LayoutAbiPortDeps {
  /** The layout store (the active workspace's tree + provider state). */
  readonly store: LayoutStore;
  /** The ops HTTP edge — bound per CALL to the then-active workspace. */
  readonly postOps: (workspaceId: string, ops: readonly LayoutOp[]) => Promise<ApplyOpsResult>;
}

/**
 * Build the ABI's `layout` port over the layout store + the ops HTTP edge
 * (pure composition — no ambient state; both deps injected). A successful
 * apply feeds the returned tree back through `onServerTree` so the local
 * client re-renders immediately (the server's WS broadcast is the
 * authoritative echo for every client, this one included — applying it twice
 * is idempotent). The workspace is read at CALL time, so a workspace switch
 * between calls targets the right tree; a switch mid-flight is guarded by
 * `onServerTree`'s own workspace filter.
 */
export function createLayoutAbiPort(deps: LayoutAbiPortDeps): LayoutAbiPort {
  return {
    async applyOps(ops): Promise<ApplyOpsResult> {
      const workspaceId = deps.store.activeWorkspaceId;
      const result = await deps.postOps(workspaceId, ops);
      if (result.ok) {
        deps.store.onServerTree(workspaceId, result.tree);
      }
      return result;
    },
    getTree(): LayoutTree | null {
      // `present` = an active provider is serving the active workspace. In
      // no-provider (and not-yet-probed) mode the local tree is a fallback,
      // not shared state — null tells the plugin there is nothing to read.
      return abiTree(deps.store.providerState, deps.store.tree);
    },
  };
}

/** The getTree decision, pure: only a PRESENT provider's tree is exposed. */
export function abiTree(state: LayoutProviderState, tree: LayoutTree): LayoutTree | null {
  return state === "present" ? tree : null;
}
