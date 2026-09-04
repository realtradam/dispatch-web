/**
 * The frontend plugin ABI (plan 03) — the contract + lifecycle machinery for
 * dynamically-imported frontend plugin modules. See `types.ts` (the surface),
 * `version.ts` (the handshake), `load-diff.ts` (pure decisions), and
 * `driver.ts` (the effectful host). The composition root (src/app) wires the
 * driver to the registry, the surfaces ports, and the plugin HTTP edge.
 */
export { createFrontendDriver, type FrontendDriver, type FrontendDriverDeps } from "./driver.js";
export {
  decideFrontendLoads,
  type FrontendCandidate,
  type FrontendCandidatesInput,
  type FrontendLoadDecision,
  frontendCandidates,
  type ImportedFrontendModule,
  usablePluginIds,
} from "./load-diff.js";
export type {
  FrontendHostAPI,
  FrontendPluginModule,
  FrontendPluginState,
  FrontendViewRegistration,
} from "./types.js";
export {
  FRONTEND_ABI_VERSION,
  isFrontendCompatible,
} from "./version.js";
