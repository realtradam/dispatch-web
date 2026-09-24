export type {
  LoadSearchBackendConfig,
  SaveSearchBackend,
  SearchBackendAvailability,
  SearchBackendConfig,
  SearchBackendConfigResult,
} from "./logic/view-model";
export {
  buildSearchBackendOptions,
  NONE_BACKEND_ID,
  NONE_BACKEND_LABEL,
  normalizeSearchBackendConfig,
  searchBackendChanged,
  searchBackendLabel,
} from "./logic/view-model";
export { default as SearchBackendField } from "./ui/SearchBackendField.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "Search Settings",
  description: "Global search backend selection for the web_search tool (GET/PUT /search/config)",
} as const;
