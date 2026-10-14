import type {
  AccountUsageLimit,
  AccountUsageProviderId,
  AccountUsageReport,
  AccountUsageResponse,
  AccountUsageState,
} from "@dispatch/transport-contract";

/**
 * Pure core types for the account-usage feature — zero DOM, zero effects.
 *
 * The backend (`account-usage` extension, transport-contract 0.25.0) polls the
 * Claude + Codex subscription usage endpoints and caches them (5 min TTL,
 * failure cooldowns, last-good retention). The FE reads `GET /usage`; a manual
 * refresh sends `?refresh=1`, which the server still rate-limits.
 */
export type {
  AccountUsageLimit,
  AccountUsageProviderId,
  AccountUsageReport,
  AccountUsageResponse,
  AccountUsageState,
};

/** Outcome of `GET /usage`. `unavailable` = the backend extension isn't loaded (503). */
export type AccountUsageResult =
  | { readonly ok: true; readonly usage: AccountUsageResponse }
  | { readonly ok: false; readonly error: string; readonly unavailable?: boolean };

/** Injected port: load the account usage (`refresh` asks the server to bypass its TTL). */
export type LoadAccountUsage = (opts?: {
  readonly refresh?: boolean;
}) => Promise<AccountUsageResult>;
