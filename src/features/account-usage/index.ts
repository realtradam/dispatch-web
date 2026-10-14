export type {
  AccountUsageDailyCredits,
  AccountUsageLimit,
  AccountUsageProviderId,
  AccountUsageReport,
  AccountUsageResponse,
  AccountUsageResult,
  AccountUsageSettingsResult,
  AccountUsageState,
  LoadAccountUsage,
  SaveAccountUsageSettings,
  UpdateAccountUsageSettingsRequest,
} from "./logic/types";
export type {
  BarTone,
  DailyCreditsView,
  ProviderCardView,
  UsageBarView,
} from "./logic/view-model";
export {
  anchorFromTimeOfDay,
  elapsedFraction,
  formatAge,
  formatDuration,
  normalizeAccountUsage,
  normalizeAccountUsageReport,
  parseAllowanceInput,
  toLocalTimeOfDay,
  viewProviderCard,
  viewProviderCards,
  viewUsageBar,
} from "./logic/view-model";
export { default as AccountUsageView } from "./ui/AccountUsageView.svelte";
export { default as DailyCreditsSettings } from "./ui/DailyCreditsSettings.svelte";
export { default as UsageBar } from "./ui/UsageBar.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
  name: "account-usage",
  description: "Claude + Codex + Hyper subscription usage bars with on-track pace markers",
} as const;
