/**
 * The frontend-module DRIVER (plan 03 §3.2) — the effectful lifecycle host.
 * Owns the imported-module set and runs ONE sync pass per trigger (boot,
 * `extensions-changed`, `workspace.set`):
 *
 * 1. diff (pure, `decideFrontendLoads`) the desired set against the
 *    imported set;
 * 2. UNLOAD stragglers: run the module's deactivate disposer (if it
 *    returned one) then the host's unregister-by-pluginId sweep — the UI is
 *    immediately correct. HONEST LIMITATION: ESM cannot be un-fetched; the
 *    bytes linger in the module cache. Re-enable re-runs `activate` on the
 *    cached module (same URL ⇒ no re-fetch).
 * 3. IMPORT newcomers: dynamic-import the URL (THE injected edge), call
 *    `activate(api)` with the plugin's own host API (forced pluginId
 *    attribution). A throwing/missing activate is LOUD: the plugin's FE
 *    half is marked failed (the backend half stays loaded) and the failure
 *    never crashes the host or blocks the other plugins.
 *
 * Syncs are serialized (a chain) — boot + extensions-changed + workspace
 * switches can overlap, and import/unload ordering must stay coherent.
 * No internal mocks: tests inject the import edge + host-API builder.
 */
import type {
  FrontendCandidate,
  FrontendLoadDecision,
  ImportedFrontendModule,
} from "./load-diff.js";
import { decideFrontendLoads } from "./load-diff.js";
import type { FrontendHostAPI, FrontendPluginModule, FrontendPluginState } from "./types.js";

export interface FrontendDriverDeps {
  /**
   * THE edge: dynamic ESM import. Injected (the composition root binds
   * `import(url)`; tests bind a fake) so nothing else in the driver touches
   * the module system.
   */
  readonly importModule: (url: string) => Promise<unknown>;
  /**
   * Build the plugin's host API — the composition root closes over the
   * registry + surfaces ports + logger and FORCES the pluginId attribution.
   */
  readonly buildHostApi: (pluginId: string) => FrontendHostAPI;
  /** The unregister-by-pluginId sweep (the registry-side unload path). */
  readonly unregisterViewsByPlugin: (pluginId: string) => void;
  readonly logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

export interface FrontendDriver {
  /** Run one sync pass. Serialized; never throws (failures are states). */
  sync(candidates: readonly FrontendCandidate[]): Promise<void>;
  /** The per-plugin states the manager UI renders. */
  states(): ReadonlyMap<string, FrontendPluginState>;
}

interface ImportedEntry extends ImportedFrontendModule {
  readonly deactivate: (() => void) | undefined;
}

export function createFrontendDriver(deps: FrontendDriverDeps): FrontendDriver {
  /** pluginId → the imported module's entry. */
  const imported = new Map<string, ImportedEntry>();
  /** pluginId → its last-known FE state (for the manager UI). */
  const pluginStates = new Map<string, FrontendPluginState>();
  /** The sync chain (serialization across triggers). */
  let chain: Promise<void> = Promise.resolve();

  /** Unload one plugin: module disposer FIRST, then the registry sweep. */
  function unload(id: string, entry: ImportedEntry): void {
    try {
      entry.deactivate?.();
    } catch (err) {
      // A broken deactivate must not block the sweep — the registration
      // ledger's force-clean philosophy (the views must not linger).
      deps.logger.warn(`frontend-plugin "${id}": deactivate threw — ${String(err)}`);
    }
    try {
      deps.unregisterViewsByPlugin(id);
    } catch (err) {
      deps.logger.warn(`frontend-plugin "${id}": unregister sweep threw — ${String(err)}`);
    }
    imported.delete(id);
    pluginStates.delete(id);
    deps.logger.info(`frontend-plugin "${id}": unloaded`);
  }

  /** Import + activate one candidate. Failures are LOUD states, not throws. */
  async function load(candidate: FrontendCandidate): Promise<void> {
    try {
      const mod = (await deps.importModule(candidate.url)) as FrontendPluginModule | undefined;
      const activate = mod?.default?.activate;
      if (typeof activate !== "function") {
        throw new Error("the module has no default.activate export");
      }
      const disposer = activate(deps.buildHostApi(candidate.id));
      imported.set(candidate.id, {
        url: candidate.url,
        deactivate: typeof disposer === "function" ? disposer : undefined,
      });
      pluginStates.set(candidate.id, { kind: "loaded" });
      deps.logger.info(`frontend-plugin "${candidate.id}": activated`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pluginStates.set(candidate.id, { kind: "failed", error: message });
      deps.logger.warn(`frontend-plugin "${candidate.id}": activation failed — ${message}`);
    }
  }

  return {
    async sync(candidates: readonly FrontendCandidate[]): Promise<void> {
      const run = chain.then(() => runSync(candidates));
      // The NEXT sync waits for this one; a rejected run must not poison the
      // chain (runSync itself never throws, but belt-and-suspenders).
      chain = run.catch(() => {});
      await run;
    },

    states(): ReadonlyMap<string, FrontendPluginState> {
      return new Map(pluginStates);
    },
  };

  async function runSync(candidates: readonly FrontendCandidate[]): Promise<void> {
    const decision: FrontendLoadDecision = decideFrontendLoads(candidates, imported);

    // The handshake verdicts persist even when nothing else changes — the
    // manager UI renders "incompatible frontend plugin" until the plugin's
    // manifest (or the host) changes.
    for (const bad of decision.incompatible) {
      pluginStates.set(bad.id, { kind: "incompatible", apiVersion: bad.apiVersion });
    }

    for (const id of decision.toUnload) {
      const entry = imported.get(id);
      if (entry !== undefined) unload(id, entry);
    }
    for (const candidate of decision.toLoad) {
      await load(candidate);
    }
  }
}
