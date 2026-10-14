export type {
  AccountUsageLimit,
  AccountUsageProviderId,
  AccountUsageReport,
  AccountUsageResponse,
  AccountUsageResult,
  AccountUsageState,
  LoadAccountUsage,
} from "./logic/types";
export type { BarTone, ProviderCardView, UsageBarView } from "./logic/view-model";
export {
  elapsedFraction,
  formatAge,
  formatDuration,
  normalizeAccountUsage,
  viewProviderCard,
  viewProviderCards,
  viewUsageBar,
} from "./logic/view-model";
export { default as AccountUsageView } from "./ui/AccountUsageView.svelte";
export { default as UsageBar } from "./ui/UsageBar.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "account-usage",
  description: "Claude + Codex subscription usage bars with on-track pace markers",
} as const;
