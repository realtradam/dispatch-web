import type { AccountUsageLimit, AccountUsageReport } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import {
  anchorFromTimeOfDay,
  elapsedFraction,
  formatDuration,
  normalizeAccountUsage,
  parseAllowanceInput,
  toLocalTimeOfDay,
  viewProviderCard,
  viewUsageBar,
} from "./view-model";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_760_000_000_000;

function limit(over: Partial<AccountUsageLimit> = {}): AccountUsageLimit {
  return {
    id: "claude:5h",
    label: "5 Hour",
    kind: "window",
    windowId: "5h",
    shared: true,
    tier: null,
    durationMs: 5 * HOUR,
    resetsAt: NOW + 2 * HOUR,
    unit: "percent",
    used: 40,
    limit: 100,
    remaining: 60,
    usedFraction: 0.4,
    remainingFraction: 0.6,
    status: "ok",
    ...over,
  };
}

function report(over: Partial<AccountUsageReport> = {}): AccountUsageReport {
  return {
    provider: "claude",
    label: "Claude",
    state: "fresh",
    account: { accountId: "a", email: "me@x.com", planType: "max" },
    limits: [limit()],
    limitReached: null,
    canServe: null,
    creditOverage: false,
    credits: null,
    dailyCredits: null,
    fetchedAt: NOW - 3 * 60_000,
    lastAttemptAt: NOW - 3 * 60_000,
    nextRefreshAt: NOW + 2 * 60_000,
    error: null,
    ...over,
  };
}

describe("pace marker (elapsedFraction)", () => {
  it("is halfway two weeks into a four-week window", () => {
    const resetsAt = NOW + 14 * DAY;
    expect(elapsedFraction(28 * DAY, resetsAt, NOW)).toBeCloseTo(0.5);
  });

  it("clamps to 0..1 and is null when the window is unknown", () => {
    expect(elapsedFraction(5 * HOUR, NOW + 10 * HOUR, NOW)).toBe(0);
    expect(elapsedFraction(5 * HOUR, NOW - HOUR, NOW)).toBe(1);
    expect(elapsedFraction(null, NOW, NOW)).toBeNull();
    expect(elapsedFraction(5 * HOUR, null, NOW)).toBeNull();
  });
});

describe("viewUsageBar", () => {
  it("places the pace marker at elapsed % and labels ahead/under pace", () => {
    // 5h window resetting in 2h ⇒ 3h elapsed ⇒ 60% pace; used 40% ⇒ 20% under.
    const bar = viewUsageBar(limit(), NOW);
    expect(bar.percent).toBe(40);
    expect(bar.pacePercent).toBeCloseTo(60);
    expect(bar.paceLabel).toBe("20% under pace");
    expect(bar.aheadOfPace).toBe(false);
    expect(bar.resetLabel).toBe("resets in 2h");
    expect(bar.valueLabel).toBe("40%");
    expect(bar.tone).toBe("success");

    const ahead = viewUsageBar(limit({ used: 80, usedFraction: 0.8 }), NOW);
    expect(ahead.paceLabel).toBe("20% ahead of pace");
    expect(ahead.aheadOfPace).toBe(true);
    expect(ahead.tone).toBe("warning");
  });

  it("has no pace marker for spend meters; formats dollars", () => {
    const spend = viewUsageBar(
      limit({
        id: "claude:extra",
        kind: "spend",
        unit: "usd",
        durationMs: null,
        resetsAt: null,
        used: 12.5,
        limit: 50,
        usedFraction: 0.25,
      }),
      NOW,
    );
    expect(spend.pacePercent).toBeNull();
    expect(spend.valueLabel).toBe("$12.50 / $50.00");
    const uncapped = viewUsageBar(
      limit({
        unit: "usd",
        kind: "spend",
        limit: null,
        usedFraction: null,
        used: 3,
        durationMs: null,
      }),
      NOW,
    );
    expect(uncapped.valueLabel).toBe("$3.00 (no cap)");
    expect(uncapped.percent).toBe(0);
  });

  it("exhausted → error tone", () => {
    expect(viewUsageBar(limit({ used: 100, usedFraction: 1, status: "exhausted" }), NOW).tone).toBe(
      "error",
    );
  });
});

describe("viewProviderCard", () => {
  it("fresh card with subtitle and age", () => {
    const c = viewProviderCard(report(), NOW);
    expect(c.subtitle).toBe("Max · me@x.com");
    expect(c.stateBadge).toBeNull();
    expect(c.message).toBeNull();
    expect(c.ageLabel).toBe("3m ago");
    expect(c.bars).toHaveLength(1);
  });

  it("stale / not-configured / unsupported states", () => {
    const stale = viewProviderCard(report({ state: "stale", error: "HTTP 429" }), NOW);
    expect(stale.stateBadge).toBe("stale");
    expect(stale.message).toContain("HTTP 429");
    const nc = viewProviderCard(
      report({
        provider: "codex",
        label: "Codex",
        state: "not-configured",
        limits: [],
        account: null,
      }),
      NOW,
    );
    expect(nc.stateBadge).toBe("not configured");
    expect(nc.message).toContain("Codex");
    expect(nc.ageLabel).toBeNull();
    const un = viewProviderCard(
      report({ state: "unsupported", error: "api key", limits: [] }),
      NOW,
    );
    expect(un.message).toBe("api key");
  });

  it("credit overage note", () => {
    const c = viewProviderCard(
      report({ creditOverage: true, limitReached: true, canServe: true }),
      NOW,
    );
    expect(c.creditNote).toContain("credits");
  });
});

describe("normalizeAccountUsage", () => {
  it("coerces a well-formed body and drops malformed rows", () => {
    const n = normalizeAccountUsage(
      {
        servedAt: 5,
        providers: [
          { ...report(), limits: [limit(), { id: "bad" }] },
          { provider: "gemini" },
          "junk",
        ],
      },
      0,
    );
    expect(n.servedAt).toBe(5);
    expect(n.providers).toHaveLength(1);
    expect(n.providers[0]?.limits).toHaveLength(1);
  });

  it("malformed body → empty", () => {
    expect(normalizeAccountUsage(null, 9)).toEqual({ providers: [], servedAt: 9 });
  });
});

describe("formatDuration", () => {
  it("formats", () => {
    expect(formatDuration(30_000)).toBe("<1m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(3 * HOUR + 12 * 60_000)).toBe("3h 12m");
    expect(formatDuration(2 * DAY + 4 * HOUR)).toBe("2d 4h");
  });
});

describe("hyper daily credits", () => {
  const hyperLimit = limit({
    id: "hyper:daily",
    label: "Daily credits",
    windowId: "1d",
    unit: "credits",
    durationMs: DAY,
    resetsAt: NOW + 12 * HOUR,
    used: 150,
    limit: 250,
    remaining: 100,
    usedFraction: 0.6,
  });

  it("formats credits and places the pace marker halfway through the day", () => {
    const bar = viewUsageBar(hyperLimit, NOW);
    expect(bar.valueLabel).toBe("150 / 250");
    expect(bar.pacePercent).toBeCloseTo(50);
    expect(bar.paceLabel).toBe("10% ahead of pace");
  });

  it("card exposes balance + reset source", () => {
    const c = viewProviderCard(
      report({
        provider: "hyper",
        label: "Hyper",
        account: { accountId: null, email: null, planType: null },
        limits: [hyperLimit],
        dailyCredits: { balance: 300, allowance: 250, resetAnchor: null, resetSource: null },
      }),
      NOW,
    );
    expect(c.daily).toMatchObject({
      balanceLabel: "300 credits left (incl. bundles)",
      allowance: 250,
      resetTime: "",
      resetSource: null,
    });
    expect(c.daily?.resetSourceLabel).toContain("unknown");
  });

  it("round-trips a local time of day into a past anchor", () => {
    const now = new Date(2026, 9, 14, 15, 30).getTime();
    const a = anchorFromTimeOfDay("09:00", now);
    expect(a).toBe(new Date(2026, 9, 14, 9, 0).getTime());
    expect(anchorFromTimeOfDay("17:00", now)).toBe(new Date(2026, 9, 13, 17, 0).getTime());
    expect(toLocalTimeOfDay(a ?? 0)).toBe("09:00");
    expect(anchorFromTimeOfDay("25:00", now)).toBeNull();
    expect(anchorFromTimeOfDay("noon", now)).toBeNull();
  });

  it("parses the allowance input", () => {
    expect(parseAllowanceInput(" 250 ")).toBe(250);
    expect(parseAllowanceInput("0")).toBeNull();
    expect(parseAllowanceInput("2.5")).toBeNull();
  });

  it("normalizes hyper reports + credit units", () => {
    const n = normalizeAccountUsage(
      {
        providers: [
          {
            ...report({ provider: "hyper" }),
            limits: [hyperLimit],
            dailyCredits: { balance: 1, allowance: 250, resetAnchor: 5, resetSource: "manual" },
          },
        ],
      },
      0,
    );
    expect(n.providers[0]?.limits[0]?.unit).toBe("credits");
    expect(n.providers[0]?.dailyCredits?.resetSource).toBe("manual");
  });
});
