import type {
  AccountUsageCredits,
  AccountUsageLimit,
  AccountUsageLimitStatus,
  AccountUsageProviderId,
  AccountUsageReport,
  AccountUsageResponse,
  AccountUsageState,
} from "@dispatch/transport-contract";

/**
 * Pure view-models for the account-usage feature — zero DOM, zero effects,
 * zero Svelte. Coerces the untyped `GET /usage` JSON, and shapes each limit
 * into a bar: fill %, colour, and the PACE MARKER — where usage "should" be
 * to use the whole allowance exactly by the reset (elapsed fraction of the
 * window: 2 weeks into a 4-week window ⇒ 50%).
 */

// ── Normalization (network seam) ──────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

const STATES: readonly AccountUsageState[] = [
  "fresh",
  "stale",
  "unavailable",
  "unsupported",
  "not-configured",
];
const STATUSES: readonly AccountUsageLimitStatus[] = ["ok", "warning", "exhausted", "unknown"];

function normalizeLimit(r: Record<string, unknown>): AccountUsageLimit | null {
  const id = str(r.id);
  const used = num(r.used);
  if (id === null || used === null) return null;
  const status = STATUSES.find((s) => s === r.status) ?? "unknown";
  return {
    id,
    label: str(r.label) ?? id,
    kind: r.kind === "spend" ? "spend" : "window",
    windowId: str(r.windowId) ?? "",
    shared: r.shared === true,
    tier: str(r.tier),
    durationMs: num(r.durationMs),
    resetsAt: num(r.resetsAt),
    unit: r.unit === "usd" ? "usd" : "percent",
    used,
    limit: num(r.limit),
    remaining: num(r.remaining),
    usedFraction: num(r.usedFraction),
    remainingFraction: num(r.remainingFraction),
    status,
  };
}

function normalizeCredits(v: unknown): AccountUsageCredits | null {
  if (!isRecord(v)) return null;
  return {
    hasCredits: bool(v.hasCredits),
    unlimited: bool(v.unlimited),
    overageLimitReached: bool(v.overageLimitReached),
    balance: num(v.balance),
    spendControlReached: bool(v.spendControlReached),
  };
}

function normalizeReport(r: Record<string, unknown>): AccountUsageReport | null {
  const provider: AccountUsageProviderId | null =
    r.provider === "claude" || r.provider === "codex" ? r.provider : null;
  if (provider === null) return null;
  const account = isRecord(r.account)
    ? {
        accountId: str(r.account.accountId),
        email: str(r.account.email),
        planType: str(r.account.planType),
      }
    : null;
  const limits = Array.isArray(r.limits)
    ? r.limits
        .filter(isRecord)
        .map(normalizeLimit)
        .filter((l): l is AccountUsageLimit => l !== null)
    : [];
  return {
    provider,
    label: str(r.label) ?? (provider === "claude" ? "Claude" : "Codex"),
    state: STATES.find((s) => s === r.state) ?? "unavailable",
    account,
    limits,
    limitReached: bool(r.limitReached),
    canServe: bool(r.canServe),
    creditOverage: r.creditOverage === true,
    credits: normalizeCredits(r.credits),
    fetchedAt: num(r.fetchedAt),
    lastAttemptAt: num(r.lastAttemptAt),
    nextRefreshAt: num(r.nextRefreshAt),
    error: str(r.error),
  };
}

/** Coerce the untyped `GET /usage` body. Malformed → empty provider list. */
export function normalizeAccountUsage(data: unknown, fallbackNow: number): AccountUsageResponse {
  if (!isRecord(data)) return { providers: [], servedAt: fallbackNow };
  const providers = Array.isArray(data.providers)
    ? data.providers
        .filter(isRecord)
        .map(normalizeReport)
        .filter((p): p is AccountUsageReport => p !== null)
    : [];
  return { providers, servedAt: num(data.servedAt) ?? fallbackNow };
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** "2d 4h" / "3h 12m" / "45m" / "<1m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return "<1m";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "updated 3m ago" style age, or "just now". */
export function formatAge(fetchedAt: number | null, now: number): string | null {
  if (fetchedAt === null) return null;
  const ms = now - fetchedAt;
  return ms < 60_000 ? "just now" : `${formatDuration(ms)} ago`;
}

function formatUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

// ── Bars ──────────────────────────────────────────────────────────────────────

export type BarTone = "success" | "warning" | "error" | "neutral";

export interface UsageBarView {
  readonly id: string;
  readonly label: string;
  /** Fill 0..100 for the `<progress>` value. */
  readonly percent: number;
  /** "42%" or "$12.50 / $50.00". */
  readonly valueLabel: string;
  readonly tone: BarTone;
  /**
   * Pace marker position 0..100 (% of the window elapsed) — the usage level
   * that would be "on track" to exactly use the allowance by the reset. Null
   * when the window's start can't be determined (no duration/reset).
   */
  readonly pacePercent: number | null;
  /** "+12% ahead of pace" / "8% under pace" / null. */
  readonly paceLabel: string | null;
  /** True when usage is ahead of the pace marker. */
  readonly aheadOfPace: boolean;
  /** "resets in 3h 12m" / null. */
  readonly resetLabel: string | null;
}

/**
 * Fraction (0..1) of the window elapsed at `now`. The window started at
 * `resetsAt - durationMs`; returns null when either is unknown.
 */
export function elapsedFraction(
  durationMs: number | null,
  resetsAt: number | null,
  now: number,
): number | null {
  if (durationMs === null || resetsAt === null || durationMs <= 0) return null;
  const start = resetsAt - durationMs;
  return Math.min(1, Math.max(0, (now - start) / durationMs));
}

function toneFor(status: AccountUsageLimitStatus, usedFraction: number | null): BarTone {
  if (status === "exhausted") return "error";
  if (status === "warning") return "warning";
  if (status === "ok") return usedFraction !== null && usedFraction >= 0.75 ? "warning" : "success";
  return "neutral";
}

export function viewUsageBar(limit: AccountUsageLimit, now: number): UsageBarView {
  const fraction = limit.usedFraction;
  const percent = fraction === null ? 0 : Math.min(100, Math.max(0, fraction * 100));
  const valueLabel =
    limit.unit === "usd"
      ? limit.limit === null
        ? `${formatUsd(limit.used)} (no cap)`
        : `${formatUsd(limit.used)} / ${formatUsd(limit.limit)}`
      : `${Math.round(limit.used)}%`;
  const elapsed = elapsedFraction(limit.durationMs, limit.resetsAt, now);
  const pacePercent = elapsed === null ? null : elapsed * 100;
  let paceLabel: string | null = null;
  let aheadOfPace = false;
  if (pacePercent !== null && fraction !== null) {
    const diff = Math.round(percent - pacePercent);
    aheadOfPace = diff > 0;
    paceLabel =
      diff === 0 ? "on pace" : diff > 0 ? `${diff}% ahead of pace` : `${-diff}% under pace`;
  }
  const resetLabel =
    limit.resetsAt === null
      ? null
      : limit.resetsAt <= now
        ? "resetting"
        : `resets in ${formatDuration(limit.resetsAt - now)}`;
  return {
    id: limit.id,
    label: limit.label,
    percent,
    valueLabel,
    tone: toneFor(limit.status, fraction),
    pacePercent,
    paceLabel,
    aheadOfPace,
    resetLabel,
  };
}

// ── Provider cards ────────────────────────────────────────────────────────────

export interface ProviderCardView {
  readonly provider: AccountUsageProviderId;
  readonly label: string;
  /** "Pro · me@example.com" / null. */
  readonly subtitle: string | null;
  readonly state: AccountUsageState;
  /** Badge text for non-fresh states ("stale", "unavailable", …) or null when fresh. */
  readonly stateBadge: string | null;
  /** Explanatory line for empty/non-fresh states, else null. */
  readonly message: string | null;
  readonly bars: readonly UsageBarView[];
  /** "updated 3m ago" / null. */
  readonly ageLabel: string | null;
  /** Credit-overage note (Codex), or null. */
  readonly creditNote: string | null;
}

function stateMessage(r: AccountUsageReport): string | null {
  switch (r.state) {
    case "fresh":
      return r.limits.length === 0 ? "No quota windows reported." : null;
    case "stale":
      return `Showing last known usage — refresh failed${r.error ? ` (${r.error})` : ""}.`;
    case "unavailable":
      return `Usage unavailable${r.error ? `: ${r.error}` : "."}`;
    case "unsupported":
      return r.error ?? "This credential type can't report subscription usage.";
    case "not-configured":
      return r.provider === "claude"
        ? "Not signed in to Claude (no OAuth credentials)."
        : "Not signed in to Codex (no ChatGPT OAuth credentials).";
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]?.toUpperCase() + s.slice(1);
}

export function viewProviderCard(r: AccountUsageReport, now: number): ProviderCardView {
  const parts = [
    r.account?.planType ? capitalize(r.account.planType) : null,
    r.account?.email ?? null,
  ].filter((p): p is string => p !== null && p !== "");
  let creditNote: string | null = null;
  if (r.creditOverage) {
    creditNote = "Plan allowance used — requests are being funded by credits.";
  } else if (r.limitReached === true && r.canServe === false) {
    creditNote = "Plan limit reached — requests are blocked until reset.";
  }
  return {
    provider: r.provider,
    label: r.label,
    subtitle: parts.length > 0 ? parts.join(" · ") : null,
    state: r.state,
    stateBadge: r.state === "fresh" ? null : r.state.replace("-", " "),
    message: stateMessage(r),
    bars: r.limits.map((l) => viewUsageBar(l, now)),
    ageLabel: r.state === "fresh" || r.state === "stale" ? formatAge(r.fetchedAt, now) : null,
    creditNote,
  };
}

export function viewProviderCards(
  usage: AccountUsageResponse,
  now: number,
): readonly ProviderCardView[] {
  return usage.providers.map((p) => viewProviderCard(p, now));
}
