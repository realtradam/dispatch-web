/**
 * Pure core for the search-settings feature — zero DOM, zero effects, zero
 * Svelte.
 *
 * The "Search backend" dropdown (Settings pane) picks the engine backing the
 * `web_search` tool's SEARCH mode. The selection is GLOBAL and persisted on
 * the backend (`GET/PUT /search/config`); decided entries are exactly
 * "Firecrawl (self-hosted)" + "Umans (Exa)" plus "None (search disabled)" as
 * the off state. Scrape/crawl always route to the self-hosted Firecrawl
 * backend regardless of the selection; the tool's `map` mode is removed
 * entirely (backend plan).
 */

/**
 * One selectable backend as the backend's wire advertises it (mirrors
 * `@dispatch/wire`'s `SearchBackendAvailability`).
 */
export interface SearchBackendAvailability {
  readonly id: string;
  readonly label: string;
  /** The availability gate (umans: `UMANS_API_KEY` resolves; firecrawl: always). */
  readonly configured: boolean;
}

/** The global search-backend config (`GET /search/config` response). */
export interface SearchBackendConfig {
  /** The selected backend id, or `"none"` (search off). */
  readonly backend: string;
  readonly available: readonly SearchBackendAvailability[];
}

// ── Injected ports (consumer-defines-port; the composition root adapts the
//    store's HTTP calls to these shapes). ──────────────────────────────────────

/** Outcome of `GET/PUT /search/config`. `unavailable` marks the 503 degrade
 * (the backend's search-config service not loaded) so the UI can disable the
 * field with a "search not available" hint instead of a generic error. */
export type SearchBackendConfigResult =
  | { readonly ok: true; readonly config: SearchBackendConfig }
  | { readonly ok: false; readonly error: string; readonly unavailable?: boolean };

export type LoadSearchBackendConfig = () => Promise<SearchBackendConfigResult>;

export type SaveSearchBackend = (backend: string) => Promise<SearchBackendConfigResult>;

/** The explicit off-state option label. */
export const NONE_BACKEND_ID = "none";
export const NONE_BACKEND_LABEL = "None (search disabled)";

/** One rendered `<option>` of the dropdown. */
export interface SearchBackendOption {
  readonly id: string;
  readonly label: string;
  /** Unconfigured backends stay LISTED but disabled — never an error. */
  readonly disabled: boolean;
}

/**
 * Build the dropdown options from the config: every advertised backend in
 * wire order (unconfigured ones disabled with a "not configured" suffix),
 * then the "None (search disabled)" off state appended last. If the persisted
 * selection is not among them (an unknown id from a newer/older backend), it
 * is prepended so the select can render it truthfully.
 */
export function buildSearchBackendOptions(
  config: SearchBackendConfig,
): readonly SearchBackendOption[] {
  const options: SearchBackendOption[] = config.available.map((b) => ({
    id: b.id,
    label: b.configured ? b.label : `${b.label} (not configured)`,
    disabled: !b.configured,
  }));
  if (
    config.backend !== NONE_BACKEND_ID &&
    !config.available.some((b) => b.id === config.backend)
  ) {
    options.unshift({ id: config.backend, label: `${config.backend} (unknown)`, disabled: false });
  }
  options.push({ id: NONE_BACKEND_ID, label: NONE_BACKEND_LABEL, disabled: false });
  return options;
}

/** The human-facing label for a backend id (the saved / error messages). */
export function searchBackendLabel(config: SearchBackendConfig, id: string): string {
  if (id === NONE_BACKEND_ID) {
    return NONE_BACKEND_LABEL;
  }
  return config.available.find((b) => b.id === id)?.label ?? id;
}

/** Whether selecting `selected` would change the persisted backend. */
export function searchBackendChanged(selected: string, persisted: string): boolean {
  return selected !== persisted;
}

/**
 * Normalize the untyped JSON at the network seam so a malformed/partial
 * response can never crash the renderer (mirrors `normalizeHeartbeatConfig`).
 * Unknown entries degrade to unconfigured; a missing backend falls back to
 * `"none"` rendering (the safest default for a UI that must not lie).
 */
export function normalizeSearchBackendConfig(raw: unknown): SearchBackendConfig {
  const obj = (raw ?? {}) as {
    backend?: unknown;
    available?: unknown;
  };
  const available = Array.isArray(obj.available) ? obj.available : [];
  return {
    backend:
      typeof obj.backend === "string" && obj.backend.length > 0 ? obj.backend : NONE_BACKEND_ID,
    available: available.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const e = entry as { id?: unknown; label?: unknown; configured?: unknown };
      if (typeof e.id !== "string" || e.id.length === 0) return [];
      return [
        {
          id: e.id,
          label: typeof e.label === "string" ? e.label : e.id,
          configured: e.configured === true,
        },
      ];
    }),
  };
}
