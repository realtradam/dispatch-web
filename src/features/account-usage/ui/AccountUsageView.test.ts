import type { AccountUsageResponse } from "@dispatch/transport-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AccountUsageResult } from "../logic/types";
import AccountUsageView from "./AccountUsageView.svelte";

const NOW = 1_760_000_000_000;
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
    render(AccountUsageView, { load, now: () => NOW });
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
    render(AccountUsageView, { load, now: () => NOW });
    expect(await screen.findByText(/backend extension not loaded/)).toBeTruthy();
  });
});
