/**
 * The frontend-module load DIFF (plan 03 §3.2) — pure decision logic. On
 * boot, on `extensions-changed`, and on `workspace.set`, the composition
 * root derives the DESIRED set of frontend plugins (loaded ∧
 * workspace-enabled ∧ frontend-declaring) from `GET /plugins` + the active
 * workspace's enablement rows, and diffs it against the IMPORTED set:
 * newcomers are `import()`-ed + activated; stragglers are deactivated
 * (module disposer + unregister-by-pluginId sweep); a changed import URL
 * (backend reload → new content bust) is an unload + re-import.
 *
 * The handshake runs HERE: a plugin whose `frontend.apiVersion` range does
 * not include FRONTEND_ABI_VERSION is reported "incompatible" and is NEVER
 * imported — it is also (re)unloaded if a previous version of it was
 * imported.
 */
import type { PluginListResponse, WorkspacePluginRow } from "@dispatch/transport-contract";
import { FRONTEND_ABI_VERSION, isFrontendCompatible } from "./version.js";

/** One desired frontend plugin, fully URL-resolved. */
export interface FrontendCandidate {
  readonly id: string;
  /** The import URL: the backend route + workspace + the content bust. */
  readonly url: string;
  /** The plugin's declared frontend ABI semver range (the handshake input). */
  readonly apiVersion: string;
}

/** What the currently-imported modules look like to the diff. */
export interface ImportedFrontendModule {
  /** The URL the module was imported from (a change → unload + re-import). */
  readonly url: string;
}

/** The diff verdict for one sync pass. */
export interface FrontendLoadDecision {
  /** Newcomers (or bust-changed plugins) to import + activate. */
  readonly toLoad: readonly FrontendCandidate[];
  /** Imported plugin ids no longer desired (or superseded by a new URL). */
  readonly toUnload: readonly string[];
  /** Handshake failures — "incompatible frontend plugin" in the manager UI. */
  readonly incompatible: readonly { readonly id: string; readonly apiVersion: string }[];
}

/** The composition-root inputs for candidate derivation. */
export interface FrontendCandidatesInput {
  /** The active workspace whose enablement set applies. */
  readonly workspaceId: string;
  /** The plugin ids enabled in that workspace (see `usablePluginIds`). */
  readonly usableIds: ReadonlySet<string>;
  /** The backend HTTP base (the import URL's origin). */
  readonly httpBase: string;
}

/**
 * The desired frontend-plugin set from a `GET /plugins` response: LOADED ∧
 * workspace-enabled ∧ frontend-declaring rows, one URL each. The URL is
 * `/plugins/:id/frontend?workspace=<ws>&v=<bust>` — `v` is the content
 * bust the additive list field carries (the entry's mtimeMs), so a
 * backend-side reload (new mtime) produces a NEW URL → the diff re-imports.
 */
export function frontendCandidates(
  list: PluginListResponse,
  input: FrontendCandidatesInput,
): readonly FrontendCandidate[] {
  const out: FrontendCandidate[] = [];
  for (const row of list.loaded) {
    if (row.frontend === undefined) continue;
    if (!input.usableIds.has(row.id)) continue;
    out.push({
      id: row.id,
      apiVersion: row.frontend.apiVersion,
      url: `${input.httpBase}/plugins/${encodeURIComponent(row.id)}/frontend?workspace=${encodeURIComponent(input.workspaceId)}&v=${encodeURIComponent(row.frontend.bust)}`,
    });
  }
  return out;
}

/**
 * Diff the desired set against the imported set. Handshake failures are
 * NEVER in `toLoad` — and if such a plugin WAS imported (its manifest
 * changed to an incompatible range), it lands in `toUnload`.
 */
export function decideFrontendLoads(
  candidates: readonly FrontendCandidate[],
  imported: ReadonlyMap<string, ImportedFrontendModule>,
): FrontendLoadDecision {
  const toLoad: FrontendCandidate[] = [];
  const incompatible: { id: string; apiVersion: string }[] = [];
  const desired = new Set<string>();
  /** Imported ids whose URL changed (unload + re-import — fresh code). */
  const superseded: string[] = [];

  for (const candidate of candidates) {
    if (!isFrontendCompatible(candidate.apiVersion)) {
      incompatible.push({ id: candidate.id, apiVersion: candidate.apiVersion });
      continue;
    }
    desired.add(candidate.id);
    const current = imported.get(candidate.id);
    if (current === undefined) {
      toLoad.push(candidate);
    } else if (current.url !== candidate.url) {
      // The backend reloaded the plugin (a new content bust → new URL):
      // unload the OLD instance (its disposer + registry sweep run), then
      // import the fresh code.
      superseded.push(candidate.id);
      toLoad.push(candidate);
    }
  }

  // Everything imported that is no longer a (handshake-passing) desired id,
  // plus same-id candidates whose URL changed.
  const toUnload = [...[...imported.keys()].filter((id) => !desired.has(id)), ...superseded];

  return { toLoad, toUnload, incompatible };
}

/**
 * The workspace-usable plugin ids from a `GET /workspaces/:id/plugins`
 * response (plan-06 rows) — the FE mirror of the backend's
 * `isPluginUsable`: tier "core" is usable unless explicitly `disabled`;
 * every other tier is usable only when explicitly `enabled`. The response's
 * `loaded: false` rows (records for unloaded plugins) cannot be desired
 * anyway (candidates come from the LOADED set).
 */
export function usablePluginIds(rows: readonly WorkspacePluginRow[]): ReadonlySet<string> {
  const usable = new Set<string>();
  for (const row of rows) {
    if (row.tier === "core" ? row.state !== "disabled" : row.state === "enabled") {
      usable.add(row.pluginId);
    }
  }
  return usable;
}

/** Re-export for the composition root's single-import convenience. */
export { FRONTEND_ABI_VERSION, isFrontendCompatible };
