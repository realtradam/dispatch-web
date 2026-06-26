import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type {
  ConcurrencyDeleteResult,
  ConcurrencyLimitResult,
  ConcurrencyLimitsResult,
  ConcurrencyStatusResult,
} from "../logic/types";
import ConcurrencyView from "./ConcurrencyView.svelte";

// Fakes for the four injected ports. Each resolves immediately so the mount
// effect's initial load settles in a microtask (assertions await via findBy*).

function makeFakes(opts?: {
  limits?: readonly { providerId: string; limit: number }[];
  status?: readonly ConcurrencyStatusEntry[];
}) {
  let limits = opts?.limits ?? [{ providerId: "umans", limit: 4 }];
  const status = opts?.status ?? [
    { providerId: "umans", limit: 4, inFlight: 2, queued: 1, paused: false },
  ];

  const calls = {
    loadLimits: 0,
    loadStatus: 0,
    saves: [] as { providerId: string; limit: number }[],
    deletes: [] as string[],
  };

  return {
    calls,
    loadLimits: async (): Promise<ConcurrencyLimitsResult> => {
      calls.loadLimits++;
      return { ok: true, limits };
    },
    saveLimit: async (providerId: string, limit: number): Promise<ConcurrencyLimitResult> => {
      calls.saves.push({ providerId, limit });
      // Reflect the new limit into the list the next load returns.
      limits = [...limits.filter((l) => l.providerId !== providerId), { providerId, limit }];
      return { ok: true, providerId, limit };
    },
    deleteLimit: async (providerId: string): Promise<ConcurrencyDeleteResult> => {
      calls.deletes.push(providerId);
      limits = limits.filter((l) => l.providerId !== providerId);
      return { ok: true, providerId };
    },
    loadStatus: async (): Promise<ConcurrencyStatusResult> => {
      calls.loadStatus++;
      return { ok: true, providers: status };
    },
  };
}

describe("ConcurrencyView", () => {
  it("loads + renders the configured limits and live status on mount", async () => {
    const fakes = makeFakes();
    render(ConcurrencyView, {
      props: {
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    // Limits summary (unique to the limits section) + the row's remove control.
    expect(await screen.findByText(/1 limit configured/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Remove concurrency limit for umans")).toBeVisible();
    // Status summary (unique to the status section).
    expect(await screen.findByText(/1 provider · 2\/4 in flight · 1 queued/)).toBeInTheDocument();
    expect(fakes.calls.loadLimits).toBeGreaterThanOrEqual(1);
    expect(fakes.calls.loadStatus).toBeGreaterThanOrEqual(1);
  });

  it("adds a provider limit via the form (calls saveLimit + reloads)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ limits: [], status: [] });
    render(ConcurrencyView, {
      props: {
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    await screen.findByPlaceholderText("umans");

    await user.type(screen.getByPlaceholderText("umans"), "anthropic");
    await user.type(screen.getByPlaceholderText("4"), "8");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(fakes.calls.saves).toEqual([{ providerId: "anthropic", limit: 8 }]);
    // After save the component reloads the limits list (now showing the row).
    expect(fakes.calls.loadLimits).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText(/1 limit configured/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Remove concurrency limit for anthropic")).toBeVisible();
  });

  it("disables Add when the provider id is empty or the limit is invalid", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ limits: [], status: [] });
    render(ConcurrencyView, {
      props: {
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    await screen.findByPlaceholderText("umans");
    const addBtn = screen.getByRole("button", { name: "Add" });
    expect(addBtn).toBeDisabled();

    // Provider id set but invalid limit → still disabled.
    await user.type(screen.getByPlaceholderText("umans"), "openai-compat");
    expect(addBtn).toBeDisabled();

    // Now a valid limit → enabled.
    await user.type(screen.getByPlaceholderText("4"), "5");
    expect(addBtn).toBeEnabled();
  });

  it("removes a provider limit via the row ✕ (calls deleteLimit + reloads)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes();
    render(ConcurrencyView, {
      props: {
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    // Wait for the limits to load (unique summary) before interacting.
    await screen.findByText(/1 limit configured/);
    await user.click(screen.getByLabelText("Remove concurrency limit for umans"));

    expect(fakes.calls.deletes).toEqual(["umans"]);
    expect(fakes.calls.loadLimits).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a load error from the limits endpoint", async () => {
    const failing = {
      loadLimits: async (): Promise<ConcurrencyLimitsResult> => ({
        ok: false,
        error: "Concurrency service not available",
      }),
      saveLimit: async (): Promise<ConcurrencyLimitResult> => ({ ok: false, error: "noop" }),
      deleteLimit: async (): Promise<ConcurrencyDeleteResult> => ({ ok: false, error: "noop" }),
      loadStatus: async (): Promise<ConcurrencyStatusResult> => ({ ok: true, providers: [] }),
    };
    render(ConcurrencyView, { props: failing });
    expect(await screen.findByText("Concurrency service not available")).toBeVisible();
  });
});
