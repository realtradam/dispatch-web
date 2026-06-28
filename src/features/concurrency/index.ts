export type {
  // Contract shapes re-exported for a single import surface.
  ConcurrencyCooldownResponse,
  ConcurrencyCooldownResult,
  ConcurrencyDeleteResult,
  ConcurrencyLimitEntry,
  ConcurrencyLimitResponse,
  ConcurrencyLimitResult,
  ConcurrencyLimitsResponse,
  ConcurrencyLimitsResult,
  ConcurrencyStatusEntry,
  ConcurrencyStatusResponse,
  ConcurrencyStatusResult,
  DeleteConcurrencyLimit,
  GetConcurrencyCooldown,
  GetConcurrencyLimit,
  LoadConcurrencyLimits,
  LoadConcurrencyStatus,
  RestoreOutcome,
  SaveConcurrencyCooldown,
  SaveConcurrencyLimit,
  SetConcurrencyCooldownRequest,
  SetConcurrencyLimitRequest,
} from "./logic/types";
export type {
  AutoReduceNotice,
  Badge,
  ConcurrencyLimitView,
  ConcurrencyStatusView,
} from "./logic/view-model";
export {
  autoReduceNotices,
  cooldownLabel,
  DEFAULT_COOLDOWN_MS,
  formatPauseDuration,
  normalizeConcurrencyCooldown,
  normalizeConcurrencyLimit,
  normalizeConcurrencyLimits,
  normalizeConcurrencyStatus,
  normalizeLimit,
  parseCooldownInput,
  parseLimitInput,
  pauseLabel,
  providerFromModel,
  providerOptions,
  statusLabel,
  summarizeLimits,
  summarizeStatus,
  viewAutoReduce,
  viewConcurrencyLimit,
  viewConcurrencyLimits,
  viewConcurrencyStatus,
  viewConcurrencyStatuses,
} from "./logic/view-model";
export { default as AutoReduceBanner } from "./ui/AutoReduceBanner.svelte";
export { default as ConcurrencyLimitRow } from "./ui/ConcurrencyLimitRow.svelte";
export { default as ConcurrencyView } from "./ui/ConcurrencyView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "concurrency",
  description: "Per-provider concurrency limits + live in-flight/queue status",
} as const;
