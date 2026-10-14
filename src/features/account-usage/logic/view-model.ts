import type {
  AccountUsageCredits,
  AccountUsageDailyCredits,
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
    unit: r.unit === "usd" ? "usd" : r.unit === "credits" ? "credits" : "percent",
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

function normalizeDailyCredits(v: unknown): AccountUsageDailyCredits | null {
  if (!isRecord(v)) return null;
  const balance = num(v.balance);
  const allowance = num(v.allowance);
  if (balance === null || allowance === null) return null;
  return {
    balance,
    allowance,
    resetAnchor: num(v.resetAnchor),
    resetSource: v.resetSource === "manual" || v.resetSource === "detected" ? v.resetSource : null,
  };
}

const PROVIDER_LABELS: Record<AccountUsageProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  hyper: "Hyper",
};

function normalizeReport(r: Record<string, unknown>): AccountUsageReport | null {
  const provider: AccountUsageProviderId | null =
    r.provider === "claude" || r.provider === "codex" || r.provider === "hyper" ? r.provider : null;
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
    label: str(r.label) ?? PROVIDER_LABELS[provider],
    state: STATES.find((s) => s === r.state) ?? "unavailable",
    account,
    limits,
    limitReached: bool(r.limitReached),
    canServe: bool(r.canServe),
    creditOverage: r.creditOverage === true,
    credits: normalizeCredits(r.credits),
    dailyCredits: normalizeDailyCredits(r.dailyCredits),
    fetchedAt: num(r.fetchedAt),
    lastAttemptAt: num(r.lastAttemptAt),
    nextRefreshAt: num(r.nextRefreshAt),
    error: str(r.error),
  };
}

/** Coerce one untyped report (e.g. the `PUT /usage/:provider/settings` body); null if malformed. */
export function normalizeAccountUsageReport(data: unknown): AccountUsageReport | null {
  return isRecord(data) ? normalizeReport(data) : null;
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

/** Whole credits as-is, fractional ones to 1 decimal ("150", "12.5"). */
function formatCredits(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
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
  let valueLabel: string;
  if (limit.unit === "usd") {
    valueLabel =
      limit.limit === null
        ? `${formatUsd(limit.used)} (no cap)`
        : `${formatUsd(limit.used)} / ${formatUsd(limit.limit)}`;
  } else if (limit.unit === "credits") {
    valueLabel =
      limit.limit === null
        ? `${formatCredits(limit.used)} used`
        : `${formatCredits(limit.used)} / ${formatCredits(limit.limit)}`;
  } else {
    valueLabel = `${Math.round(limit.used)}%`;
  }
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
  /** Daily-credit details + editable settings (Hyper), or null. */
  readonly daily: DailyCreditsView | null;
}

export interface DailyCreditsView {
  /** "100 credits left" (+ " (incl. bundles)" when the balance exceeds the allowance). */
  readonly balanceLabel: string;
  readonly allowance: number;
  /** The reset anchor as a local `HH:MM` (for a time input), or "" when unknown. */
  readonly resetTime: string;
  /** "set manually" / "detected from a refill (approx.)" / "unknown — set it to enable the pace marker". */
  readonly resetSourceLabel: string;
  readonly resetSource: "manual" | "detected" | null;
}

/** Local `HH:MM` of an epoch-ms instant (time-of-day only; resets recur daily). */
export function toLocalTimeOfDay(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Parse a local `HH:MM` into a reset anchor: the most recent occurrence of that
 * local time at or before `now` (any occurrence works — resets recur daily).
 * Null for malformed input.
 */
export function anchorFromTimeOfDay(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** Parse a positive-integer allowance input; null when invalid. */
export function parseAllowanceInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 1_000_000_000 ? n : null;
}

function viewDailyCredits(d: AccountUsageDailyCredits): DailyCreditsView {
  return {
    balanceLabel: `${formatCredits(d.balance)} credits left${d.balance > d.allowance ? " (incl. bundles)" : ""}`,
    allowance: d.allowance,
    resetTime: d.resetAnchor === null ? "" : toLocalTimeOfDay(d.resetAnchor),
    resetSourceLabel:
      d.resetSource === "manual"
        ? "set manually"
        : d.resetSource === "detected"
          ? "detected from a refill (approx.)"
          : "unknown — set it to enable the pace marker",
    resetSource: d.resetSource,
  };
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
      if (r.provider === "hyper") return "No Hyper API key configured (HYPER_API_KEY).";
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
    daily: r.dailyCredits ? viewDailyCredits(r.dailyCredits) : null,
  };
}

export function viewProviderCards(
  usage: AccountUsageResponse,
  now: number,
): readonly ProviderCardView[] {
  return usage.providers.map((p) => viewProviderCard(p, now));
}
