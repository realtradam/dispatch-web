import type { AccountUsageResponse } from "@dispatch/transport-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type {
  AccountUsageResult,
  AccountUsageSettingsResult,
  SaveAccountUsageSettings,
} from "../logic/types";
import AccountUsageView from "./AccountUsageView.svelte";

const NOW = 1_760_000_000_000;

const noSave: SaveAccountUsageSettings = async () => ({ ok: false, error: "unused" });
const DAY = 86_400_000;

const usage: AccountUsageResponse = {
  servedAt: NOW,
  providers: [
    {
      provider: "claude",
      label: "Claude",
      state: "fresh",
      account: { accountId: "a", email: "me@x.com", planType: "max" },
      limits: [
        {
          id: "claude:7d",
          label: "7 Day",
          kind: "window",
          windowId: "7d",
          shared: true,
          tier: null,
          durationMs: 28 * DAY,
          resetsAt: NOW + 14 * DAY,
          unit: "percent",
          used: 30,
          limit: 100,
          remaining: 70,
          usedFraction: 0.3,
          remainingFraction: 0.7,
          status: "ok",
        },
      ],
      limitReached: null,
      canServe: null,
      creditOverage: false,
      credits: null,
      dailyCredits: null,
      fetchedAt: NOW,
      lastAttemptAt: NOW,
      nextRefreshAt: NOW + 300_000,
      error: null,
    },
    {
      provider: "codex",
      label: "Codex",
      state: "not-configured",
      account: null,
      limits: [],
      limitReached: null,
      canServe: null,
      creditOverage: false,
      credits: null,
      dailyCredits: null,
      fetchedAt: null,
      lastAttemptAt: NOW,
      nextRefreshAt: NOW + 30_000,
      error: "No Codex OAuth credentials",
    },
  ],
};

describe("AccountUsageView", () => {
  it("renders a daisyUI progress bar with a pace marker at the elapsed position", async () => {
    const calls: Array<{ refresh?: boolean } | undefined> = [];
    const load = async (opts?: { refresh?: boolean }): Promise<AccountUsageResult> => {
      calls.push(opts);
      return { ok: true, usage };
    };
    render(AccountUsageView, { load, saveSettings: noSave, now: () => NOW });
    const bar = await screen.findByLabelText("7 Day usage");
    expect(bar.tagName).toBe("PROGRESS");
    expect(bar.classList.contains("progress")).toBe(true);
    expect(bar.getAttribute("value")).toBe("30");
    const marker = screen.getByTestId("pace-marker");
    expect(marker.getAttribute("style")).toContain("left: 50%");
    expect(screen.getByText("20% under pace")).toBeTruthy();
    expect(screen.getByText(/Not signed in to Codex/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Refresh account usage" }));
    expect(calls.at(-1)).toEqual({ refresh: true });
  });

  it("shows the unavailable message on 503", async () => {
    const load = async (): Promise<AccountUsageResult> => ({
      ok: false,
      error: "x",
      unavailable: true,
    });
    render(AccountUsageView, { load, saveSettings: noSave, now: () => NOW });
    expect(await screen.findByText(/backend extension not loaded/)).toBeTruthy();
  });

  it("edits the Hyper allowance + reset time and splices the saved report", async () => {
    const hyper = {
      provider: "hyper" as const,
      label: "Hyper",
      state: "fresh" as const,
      account: { accountId: null, email: null, planType: null },
      limits: [
        {
          id: "hyper:daily",
          label: "Daily credits",
          kind: "window" as const,
          windowId: "1d",
          shared: true,
          tier: null,
          durationMs: DAY,
          resetsAt: null,
          unit: "credits" as const,
          used: 150,
          limit: 250,
          remaining: 100,
          usedFraction: 0.6,
          remainingFraction: 0.4,
          status: "ok" as const,
        },
      ],
      limitReached: null,
      canServe: true,
      creditOverage: false,
      credits: null,
      dailyCredits: { balance: 100, allowance: 250, resetAnchor: null, resetSource: null },
      fetchedAt: NOW,
      lastAttemptAt: NOW,
      nextRefreshAt: NOW + 300_000,
      error: null,
    };
    const load = async (): Promise<AccountUsageResult> => ({
      ok: true,
      usage: { servedAt: NOW, providers: [hyper] },
    });
    const saved: Array<Parameters<SaveAccountUsageSettings>[1]> = [];
    const saveSettings: SaveAccountUsageSettings = async (_p, settings) => {
      saved.push(settings);
      const r: AccountUsageSettingsResult = {
        ok: true,
        report: {
          ...hyper,
          limits: [
            {
              ...(hyper.limits[0] as (typeof hyper.limits)[0]),
              limit: 300,
              resetsAt: NOW + DAY / 2,
            },
          ],
          dailyCredits: {
            balance: 100,
            allowance: 300,
            resetAnchor: NOW - DAY / 2,
            resetSource: "manual",
          },
        },
      };
      return r;
    };
    render(AccountUsageView, { load, saveSettings, now: () => NOW });
    expect(await screen.findByText("150 / 250")).toBeTruthy();
    expect(screen.queryByTestId("pace-marker")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit Hyper credit settings" }));
    const allowance = screen.getByLabelText("Daily credit allowance");
    await userEvent.clear(allowance);
    await userEvent.type(allowance, "300");
    const time = screen.getByLabelText("Daily credit reset time") as HTMLInputElement;
    await userEvent.type(time, "09:00");
    await userEvent.click(screen.getByRole("button", { name: "Save Hyper credit settings" }));

    expect(saved[0]?.dailyAllowance).toBe(300);
    expect(typeof saved[0]?.resetAnchor).toBe("number");
    expect(await screen.findByText(/set manually/)).toBeTruthy();
    expect(screen.getByTestId("pace-marker")).toBeTruthy();
  });
});
