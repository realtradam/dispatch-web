import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import {
  autoReduceNotices,
  cooldownLabel,
  DEFAULT_COOLDOWN_MS,
  formatPauseDuration,
  normalizeConcurrencyCooldown,
  normalizeConcurrencyLimit,
  normalizeConcurrencyLimits,
  normalizeConcurrencyStatus,
  parseCooldownInput,
  parseLimitInput,
  pauseLabel,
  providerFromModel,
  providerOptions,
  summarizeLimits,
  summarizeStatus,
  viewAutoReduce,
  viewConcurrencyLimit,
  viewConcurrencyLimits,
  viewConcurrencyStatus,
  viewConcurrencyStatuses,
} from "./view-model";

const status = (over: Partial<ConcurrencyStatusEntry> = {}): ConcurrencyStatusEntry => ({
  providerId: "umans",
  limit: 4,
  inFlight: 2,
  queued: 0,
  paused: false,
  cooldownMs: 350,
  autoReduced: false,
  ...over,
});

// ── parseLimitInput ───────────────────────────────────────────────────────────

describe("parseLimitInput", () => {
  it("accepts positive integers", () => {
    expect(parseLimitInput("4")).toBe(4);
    expect(parseLimitInput(" 12 ")).toBe(12);
    expect(parseLimitInput("1")).toBe(1);
  });

  it("rejects zero, negatives, non-integers, and garbage", () => {
    expect(parseLimitInput("0")).toBeNull();
    expect(parseLimitInput("-1")).toBeNull();
    expect(parseLimitInput("4.5")).toBeNull();
    expect(parseLimitInput("")).toBeNull();
    expect(parseLimitInput("   ")).toBeNull();
    expect(parseLimitInput("abc")).toBeNull();
    expect(parseLimitInput("4abc")).toBeNull();
  });
});

// ── parseCooldownInput (non-negative integer — 0 is valid, unlike the limit) ──

describe("parseCooldownInput", () => {
  it("accepts zero + positive integers", () => {
    expect(parseCooldownInput("0")).toBe(0);
    expect(parseCooldownInput("350")).toBe(350);
    expect(parseCooldownInput(" 100 ")).toBe(100);
  });

  it("rejects negatives, non-integers, and garbage", () => {
    expect(parseCooldownInput("-1")).toBeNull();
    expect(parseCooldownInput("4.5")).toBeNull();
    expect(parseCooldownInput("")).toBeNull();
    expect(parseCooldownInput("abc")).toBeNull();
    expect(parseCooldownInput("100ms")).toBeNull();
  });
});

// ── cooldownLabel ─────────────────────────────────────────────────────────────

describe("cooldownLabel", () => {
  it("0 → off label", () => {
    expect(cooldownLabel(0)).toBe("0ms (off)");
  });
  it("sub-second → ms", () => {
    expect(cooldownLabel(350)).toBe("350ms");
    expect(cooldownLabel(999)).toBe("999ms");
  });
  it("≥1s → seconds (trims trailing .0)", () => {
    expect(cooldownLabel(1000)).toBe("1s");
    expect(cooldownLabel(1500)).toBe("1.5s");
    expect(cooldownLabel(60_000)).toBe("60s");
  });
});

// ── providerFromModel / providerOptions ───────────────────────────────────────

describe("providerFromModel", () => {
  it("takes the part before the first slash", () => {
    expect(providerFromModel("openai/gpt-4o")).toBe("openai");
    expect(providerFromModel("openai-compat/gpt-4o-mini")).toBe("openai-compat");
  });
  it("returns the whole string when there is no slash", () => {
    expect(providerFromModel("umans")).toBe("umans");
  });
});

describe("providerOptions", () => {
  it("derives distinct provider ids from models, first-seen order", () => {
    expect(
      providerOptions(["openai/gpt-4o", "umans/umans-glm-5.2", "openai/gpt-4o-mini"], []),
    ).toEqual(["openai", "umans"]);
  });
  it("unions with providers already carrying a configured limit", () => {
    expect(providerOptions(["openai/gpt-4o"], [{ providerId: "anthropic", limit: 4 }])).toEqual([
      "openai",
      "anthropic",
    ]);
  });
  it("does not duplicate a provider present in both models and limits", () => {
    expect(providerOptions(["openai/gpt-4o"], [{ providerId: "openai", limit: 4 }])).toEqual([
      "openai",
    ]);
  });
  it("ignores models whose provider prefix is empty", () => {
    expect(providerOptions(["/model-only", "umans/x"], [])).toEqual(["umans"]);
  });
  it("returns [] when there are no models and no limits", () => {
    expect(providerOptions([], [])).toEqual([]);
  });
});

// ── pauseLabel + formatPauseDuration ───────────────────────────────────────────

describe("formatPauseDuration", () => {
  it("formats seconds / minutes+seconds / hours+minutes", () => {
    expect(formatPauseDuration(30_000)).toBe("30s");
    expect(formatPauseDuration(65_000)).toBe("1m 05s");
    expect(formatPauseDuration(3_660_000)).toBe("1h 01m");
  });

  it("non-positive → resuming", () => {
    expect(formatPauseDuration(0)).toBe("resuming");
    expect(formatPauseDuration(-5_000)).toBe("resuming");
  });
});

describe("pauseLabel", () => {
  it("null when not paused", () => {
    expect(pauseLabel(false, undefined, 0)).toBeNull();
    expect(pauseLabel(false, 10_000, 0)).toBeNull();
  });

  it("'paused' (bare) when paused without a usable timestamp", () => {
    expect(pauseLabel(true, undefined, 0)).toBe("paused");
    expect(pauseLabel(true, null, 0)).toBe("paused");
    expect(pauseLabel(true, Number.NaN, 0)).toBe("paused");
  });

  it("countdown when paused with a future timestamp", () => {
    const now = 1_000_000;
    expect(pauseLabel(true, now + 30_000, now)).toBe("paused — resumes in 30s");
    expect(pauseLabel(true, now + 65_000, now)).toBe("paused — resumes in 1m 05s");
  });

  it("'paused' (bare) when the timestamp is missing, non-finite, or expired", () => {
    expect(pauseLabel(true, 0, 1_000)).toBe("paused");
    expect(pauseLabel(true, 1_000, 2_000)).toBe("paused");
    expect(pauseLabel(true, Number.NaN, 0)).toBe("paused");
    // The countdown prefix only appears with a FUTURE timestamp:
    expect(pauseLabel(true, 2_000, 1_000)).toBe("paused — resumes in 1s");
  });
});

// ── viewConcurrencyStatus ──────────────────────────────────────────────────────

describe("viewConcurrencyStatus", () => {
  it("serving under capacity → success badge, in-flight label, no queue", () => {
    const v = viewConcurrencyStatus(status({ inFlight: 2, limit: 4, queued: 0 }), 0);
    expect(v.inFlightLabel).toBe("2/4");
    expect(v.queuedLabel).toBe("no queue");
    expect(v.pausedLabel).toBeNull();
    expect(v.badge).toBe("success");
    expect(v.busy).toBe(false);
  });

  it("at capacity with a queue → warning badge + busy (spinner)", () => {
    const v = viewConcurrencyStatus(status({ inFlight: 4, limit: 4, queued: 3 }), 0);
    expect(v.inFlightLabel).toBe("4/4");
    expect(v.queuedLabel).toBe("3 queued");
    expect(v.badge).toBe("warning");
    expect(v.busy).toBe(true);
  });

  it("idle (no in-flight) → neutral badge, not busy", () => {
    const v = viewConcurrencyStatus(status({ inFlight: 0, limit: 4, queued: 0 }), 0);
    expect(v.badge).toBe("neutral");
    expect(v.busy).toBe(false);
    expect(v.inFlightLabel).toBe("0/4");
  });

  it("paused → warning badge + pause countdown label", () => {
    const now = 1_000_000;
    const v = viewConcurrencyStatus(
      status({ paused: true, pausedUntil: now + 30_000, inFlight: 4, limit: 4, queued: 3 }),
      now,
    );
    expect(v.paused).toBe(true);
    expect(v.pausedLabel).toBe("paused — resumes in 30s");
    expect(v.badge).toBe("warning");
    expect(v.busy).toBe(true);
  });

  it("at capacity but no queue → success (busy only when queuing)", () => {
    const v = viewConcurrencyStatus(status({ inFlight: 4, limit: 4, queued: 0 }), 0);
    expect(v.badge).toBe("success");
    expect(v.busy).toBe(false);
  });

  it("normalizes garbage counts to 0 and a malformed limit to 1", () => {
    const v = viewConcurrencyStatus(
      {
        providerId: "x",
        limit: -3,
        inFlight: Number.NaN,
        queued: "oops" as unknown as number,
        paused: false,
        cooldownMs: Number.NaN,
        autoReduced: false,
      },
      0,
    );
    expect(v.limit).toBe(1);
    expect(v.inFlight).toBe(0);
    expect(v.queued).toBe(0);
    expect(v.inFlightLabel).toBe("0/1");
    expect(v.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
  });

  it("viewConcurrencyStatuses maps a list preserving order", () => {
    const views = viewConcurrencyStatuses(
      [status({ providerId: "a" }), status({ providerId: "b" })],
      0,
    );
    expect(views.map((v) => v.providerId)).toEqual(["a", "b"]);
  });

  it("carries cooldownMs + label + autoReduced fields onto the view", () => {
    const v = viewConcurrencyStatus(status({ cooldownMs: 1500 }), 0);
    expect(v.cooldownMs).toBe(1500);
    expect(v.cooldownLabel).toBe("1.5s");
    expect(v.autoReduced).toBe(false);
    expect(v.autoReducedFrom).toBeNull();
  });

  it("auto-reduced → warning badge (not busy) + autoReducedFrom carried", () => {
    const v = viewConcurrencyStatus(
      status({ limit: 3, autoReduced: true, autoReducedFrom: 4, inFlight: 0 }),
      0,
    );
    expect(v.autoReduced).toBe(true);
    expect(v.autoReducedFrom).toBe(4);
    expect(v.badge).toBe("warning");
    // autoReduced alone does NOT flip busy (a reduced limit still admits agents).
    expect(v.busy).toBe(false);
  });
});

// ── viewAutoReduce / autoReduceNotices (the auto-reduce banner view) ───────────

describe("viewAutoReduce", () => {
  it("returns null when not auto-reduced", () => {
    expect(viewAutoReduce(status({ autoReduced: false }))).toBeNull();
  });

  it("uses the backend notice verbatim + carries from/current limits", () => {
    const notice = viewAutoReduce(
      status({
        limit: 3,
        autoReduced: true,
        autoReducedFrom: 4,
        notice: "Concurrency limit auto-reduced to 3 after a 429.",
      }),
    );
    expect(notice).toEqual({
      providerId: "umans",
      message: "Concurrency limit auto-reduced to 3 after a 429.",
      fromLimit: 4,
      currentLimit: 3,
    });
  });

  it("synthesizes a fallback notice when the backend notice is absent/empty", () => {
    expect(viewAutoReduce(status({ limit: 3, autoReduced: true, autoReducedFrom: 4 }))).toEqual({
      providerId: "umans",
      message: "Concurrency limit auto-reduced to 3 after a 429 — restore manually when ready.",
      fromLimit: 4,
      currentLimit: 3,
    });
    expect(
      viewAutoReduce(status({ limit: 3, autoReduced: true, autoReducedFrom: 4, notice: "" })),
    ).not.toBeNull();
  });

  it("falls back to currentLimit+1 when autoReducedFrom is missing/garbage", () => {
    const notice = viewAutoReduce(status({ limit: 3, autoReduced: true }));
    expect(notice?.fromLimit).toBe(4); // 3 + 1
  });
});

describe("autoReduceNotices", () => {
  it("collects one banner per auto-reduced provider (input order), empty when none", () => {
    expect(autoReduceNotices([status({ providerId: "a" })])).toEqual([]);
    const out = autoReduceNotices([
      status({ providerId: "a", autoReduced: true, autoReducedFrom: 4, limit: 3 }),
      status({ providerId: "b" }),
      status({ providerId: "c", autoReduced: true, autoReducedFrom: 2, limit: 1 }),
    ]);
    expect(out.map((n) => n.providerId)).toEqual(["a", "c"]);
    expect(out[1]?.fromLimit).toBe(2);
  });
});

// ── viewConcurrencyLimit ───────────────────────────────────────────────────────

describe("viewConcurrencyLimit", () => {
  it("passes through id + normalizes the limit", () => {
    const v = viewConcurrencyLimit({ providerId: "umans", limit: 4 });
    expect(v.providerId).toBe("umans");
    expect(v.limit).toBe(4);
  });

  it("clamps a malformed limit to 1", () => {
    expect(viewConcurrencyLimit({ providerId: "x", limit: 0 }).limit).toBe(1);
    expect(viewConcurrencyLimit({ providerId: "x", limit: -2 }).limit).toBe(1);
    expect(viewConcurrencyLimit({ providerId: "x", limit: 2.9 }).limit).toBe(2);
  });

  it("viewConcurrencyLimits maps a list preserving order", () => {
    const views = viewConcurrencyLimits([
      { providerId: "a", limit: 1 },
      { providerId: "b", limit: 2 },
    ]);
    expect(views.map((v) => v.providerId)).toEqual(["a", "b"]);
  });
});

// ── summarizeLimits / summarizeStatus ──────────────────────────────────────────

describe("summarizeLimits", () => {
  it("empty → No limits configured", () => {
    expect(summarizeLimits([])).toBe("No limits configured");
  });
  it("counts limits (singular/plural)", () => {
    expect(summarizeLimits([{ providerId: "a", limit: 1 }])).toBe("1 limit configured");
    expect(
      summarizeLimits([
        { providerId: "a", limit: 1 },
        { providerId: "b", limit: 2 },
      ]),
    ).toBe("2 limits configured");
  });
});

describe("summarizeStatus", () => {
  it("empty → No limits configured", () => {
    expect(summarizeStatus([], 0)).toBe("No limits configured");
  });
  it("aggregates providers + in-flight totals", () => {
    const s = summarizeStatus(
      [
        status({ providerId: "a", limit: 4, inFlight: 2 }),
        status({ providerId: "b", limit: 6, inFlight: 3 }),
      ],
      0,
    );
    expect(s).toBe("2 providers · 5/10 in flight");
  });
  it("includes queued + paused fragments only when non-zero", () => {
    const s = summarizeStatus(
      [
        status({ providerId: "a", limit: 4, inFlight: 4, queued: 2 }),
        status({
          providerId: "b",
          limit: 4,
          inFlight: 1,
          queued: 0,
          paused: true,
          pausedUntil: 1000,
        }),
      ],
      0,
    );
    expect(s).toBe("2 providers · 5/8 in flight · 2 queued · 1 paused");
  });
  it("singular provider", () => {
    expect(summarizeStatus([status({ providerId: "a", limit: 4, inFlight: 1 })], 0)).toBe(
      "1 provider · 1/4 in flight",
    );
  });
  it("includes an auto-reduced fragment only when non-zero", () => {
    const s = summarizeStatus(
      [
        status({ providerId: "a", limit: 3, inFlight: 1, autoReduced: true, autoReducedFrom: 4 }),
        status({ providerId: "b", limit: 4, inFlight: 1 }),
      ],
      0,
    );
    expect(s).toBe("2 providers · 2/7 in flight · 1 auto-reduced");
  });
});

// ── Network-seam normalizers ───────────────────────────────────────────────────

describe("normalizeConcurrencyLimits", () => {
  it("coerces a well-formed body", () => {
    const limits = normalizeConcurrencyLimits({
      limits: [
        { providerId: "umans", limit: 4 },
        { providerId: "openai-compat", limit: 5 },
      ],
    });
    expect(limits).toEqual([
      { providerId: "umans", limit: 4 },
      { providerId: "openai-compat", limit: 5 },
    ]);
  });

  it("non-array / missing limits → []", () => {
    expect(normalizeConcurrencyLimits({})).toEqual([]);
    expect(normalizeConcurrencyLimits({ limits: "nope" })).toEqual([]);
    expect(normalizeConcurrencyLimits(null)).toEqual([]);
    expect(normalizeConcurrencyLimits(undefined)).toEqual([]);
  });

  it("drops entries without a provider id + clamps limits", () => {
    const limits = normalizeConcurrencyLimits({
      limits: [
        { providerId: "umans", limit: 4 },
        { providerId: "", limit: 9 },
        { providerId: 123, limit: 1 },
        { limit: 2 },
        { providerId: "anthropic", limit: -5 },
      ],
    });
    expect(limits).toEqual([
      { providerId: "umans", limit: 4 },
      { providerId: "anthropic", limit: 1 },
    ]);
  });
});

describe("normalizeConcurrencyLimit", () => {
  it("coerces a well-formed single response", () => {
    expect(normalizeConcurrencyLimit({ providerId: "umans", limit: 4 })).toEqual({
      providerId: "umans",
      limit: 4,
    });
  });
  it("null when the provider id is missing/non-string", () => {
    expect(normalizeConcurrencyLimit({ limit: 4 })).toBeNull();
    expect(normalizeConcurrencyLimit({ providerId: "", limit: 4 })).toBeNull();
    expect(normalizeConcurrencyLimit(null)).toBeNull();
  });
  it("clamps a malformed limit to 1", () => {
    expect(normalizeConcurrencyLimit({ providerId: "x", limit: 0 })).toEqual({
      providerId: "x",
      limit: 1,
    });
  });
});

describe("normalizeConcurrencyStatus", () => {
  it("coerces a well-formed body, preserving pausedUntil only when present", () => {
    const now = Date.now();
    const providers = normalizeConcurrencyStatus({
      providers: [
        { providerId: "umans", limit: 4, inFlight: 2, queued: 1, paused: false },
        {
          providerId: "openai-compat",
          limit: 5,
          inFlight: 5,
          queued: 3,
          paused: true,
          pausedUntil: now,
        },
      ],
    });
    expect(providers).toHaveLength(2);
    const [first, second] = providers;
    expect(first).toEqual({
      providerId: "umans",
      limit: 4,
      inFlight: 2,
      queued: 1,
      paused: false,
      cooldownMs: 350,
      autoReduced: false,
    });
    expect(first !== undefined && !("pausedUntil" in first)).toBe(true);
    expect(second).toEqual({
      providerId: "openai-compat",
      limit: 5,
      inFlight: 5,
      queued: 3,
      paused: true,
      pausedUntil: now,
      cooldownMs: 350,
      autoReduced: false,
    });
  });

  it("non-array / missing providers → []", () => {
    expect(normalizeConcurrencyStatus({})).toEqual([]);
    expect(normalizeConcurrencyStatus({ providers: 42 })).toEqual([]);
    expect(normalizeConcurrencyStatus(null)).toEqual([]);
  });

  it("drops entries without a provider id + clamps counts", () => {
    const providers = normalizeConcurrencyStatus({
      providers: [
        { providerId: "umans", limit: 4, inFlight: 2, queued: 1, paused: false },
        { providerId: "", inFlight: 1 },
        { limit: 2 },
        { providerId: 9, inFlight: 0 },
        { providerId: "x", limit: -1, inFlight: "bad", queued: null, paused: "yes" },
      ],
    });
    expect(providers).toEqual([
      {
        providerId: "umans",
        limit: 4,
        inFlight: 2,
        queued: 1,
        paused: false,
        cooldownMs: 350,
        autoReduced: false,
      },
      {
        providerId: "x",
        limit: 1,
        inFlight: 0,
        queued: 0,
        paused: false,
        cooldownMs: 350,
        autoReduced: false,
      },
    ]);
  });

  it("omits pausedUntil when it is not a finite number", () => {
    const providers = normalizeConcurrencyStatus({
      providers: [
        { providerId: "a", limit: 1, inFlight: 0, queued: 0, paused: true, pausedUntil: "x" },
        { providerId: "b", limit: 1, inFlight: 0, queued: 0, paused: true, pausedUntil: null },
      ],
    });
    for (const p of providers) expect("pausedUntil" in p).toBe(false);
  });

  it("coerces cooldownMs (default 350) + carries auto-reduce fields only when true", () => {
    const [reduced, healthy] = normalizeConcurrencyStatus({
      providers: [
        {
          providerId: "umans",
          limit: 3,
          inFlight: 1,
          queued: 0,
          paused: false,
          cooldownMs: 500,
          autoReduced: true,
          autoReducedFrom: 4,
          notice: "auto-reduced to 3 after a 429.",
        },
        { providerId: "openai", limit: 4, inFlight: 0, queued: 0, paused: false },
      ],
    });
    expect(reduced?.cooldownMs).toBe(500);
    expect(reduced?.autoReduced).toBe(true);
    expect(reduced?.autoReducedFrom).toBe(4);
    expect(reduced?.notice).toBe("auto-reduced to 3 after a 429.");
    // Healthy entry: cooldownMs defaults to 350 when absent; auto-reduce fields
    // are NOT present (they are only included when autoReduced===true).
    expect(healthy?.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
    expect(healthy?.autoReduced).toBe(false);
    expect(healthy && "autoReducedFrom" in healthy).toBe(false);
    expect(healthy && "notice" in healthy).toBe(false);
  });

  it("drops autoReducedFrom/notice when autoReduced is false (even if present in JSON)", () => {
    const [p] = normalizeConcurrencyStatus({
      providers: [
        {
          providerId: "x",
          limit: 4,
          inFlight: 0,
          queued: 0,
          paused: false,
          autoReduced: false,
          autoReducedFrom: 9,
          notice: "stale",
        },
      ],
    });
    expect(p?.autoReduced).toBe(false);
    expect(p && "autoReducedFrom" in p).toBe(false);
    expect(p && "notice" in p).toBe(false);
  });
});

// ── normalizeConcurrencyCooldown ───────────────────────────────────────────────

describe("normalizeConcurrencyCooldown", () => {
  it("coerces a well-formed body", () => {
    expect(normalizeConcurrencyCooldown({ providerId: "umans", cooldownMs: 500 })).toEqual({
      providerId: "umans",
      cooldownMs: 500,
    });
  });

  it("defaults a malformed/absent cooldownMs to 350", () => {
    expect(normalizeConcurrencyCooldown({ providerId: "x", cooldownMs: -1 })?.cooldownMs).toBe(
      DEFAULT_COOLDOWN_MS,
    );
    expect(normalizeConcurrencyCooldown({ providerId: "x" })?.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
    expect(normalizeConcurrencyCooldown({ providerId: "x", cooldownMs: "fast" })?.cooldownMs).toBe(
      DEFAULT_COOLDOWN_MS,
    );
  });

  it("returns null for a missing/malformed providerId", () => {
    expect(normalizeConcurrencyCooldown({ cooldownMs: 350 })).toBeNull();
    expect(normalizeConcurrencyCooldown({ providerId: "", cooldownMs: 350 })).toBeNull();
    expect(normalizeConcurrencyCooldown(null)).toBeNull();
    expect(normalizeConcurrencyCooldown({})).toBeNull();
  });
});
