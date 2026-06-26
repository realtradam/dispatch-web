export type {
  ConcurrencyDeleteResult,
  ConcurrencyLimitEntry,
  // Contract shapes re-exported for a single import surface.
  ConcurrencyLimitResponse,
  ConcurrencyLimitResult,
  ConcurrencyLimitsResponse,
  ConcurrencyLimitsResult,
  ConcurrencyStatusEntry,
  ConcurrencyStatusResponse,
  ConcurrencyStatusResult,
  DeleteConcurrencyLimit,
  GetConcurrencyLimit,
  LoadConcurrencyLimits,
  LoadConcurrencyStatus,
  SaveConcurrencyLimit,
  SetConcurrencyLimitRequest,
} from "./logic/types";
export type { Badge, ConcurrencyLimitView, ConcurrencyStatusView } from "./logic/view-model";
export {
  formatPauseDuration,
  normalizeConcurrencyLimit,
  normalizeConcurrencyLimits,
  normalizeConcurrencyStatus,
  normalizeLimit,
  parseLimitInput,
  pauseLabel,
  summarizeLimits,
  summarizeStatus,
  viewConcurrencyLimit,
  viewConcurrencyLimits,
  viewConcurrencyStatus,
  viewConcurrencyStatuses,
} from "./logic/view-model";
export { default as ConcurrencyLimitRow } from "./ui/ConcurrencyLimitRow.svelte";
export { default as ConcurrencyView } from "./ui/ConcurrencyView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "concurrency",
  description: "Per-provider concurrency limits + live in-flight/queue status",
} as const;
