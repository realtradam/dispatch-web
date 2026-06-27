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

// Available models → provider ids are "umans", "anthropic", "openai-compat".
const MODELS = ["umans/umans-glm-5.2", "anthropic/claude-sonnet", "openai-compat/gpt-4o"] as const;

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
        models: MODELS,
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    // The provider dropdown is populated from the available models' providers.
    const providerSelect = await screen.findByLabelText("Provider");
    expect(providerSelect).toBeVisible();
    // Limits summary (unique to the limits section) + the row's remove control.
    expect(await screen.findByText(/1 limit configured/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Remove concurrency limit for umans")).toBeVisible();
    // Status summary (unique to the status section).
    expect(await screen.findByText(/1 provider · 2\/4 in flight · 1 queued/)).toBeInTheDocument();
    expect(fakes.calls.loadLimits).toBeGreaterThanOrEqual(1);
    expect(fakes.calls.loadStatus).toBeGreaterThanOrEqual(1);
  });

  it("adds a provider limit via the dropdown form (calls saveLimit + reloads)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ limits: [], status: [] });
    render(ConcurrencyView, {
      props: {
        models: MODELS,
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    const providerSelect = await screen.findByLabelText("Provider");
    // Choose "anthropic" from the dropdown (the list is auto-selected first).
    await user.selectOptions(providerSelect, "anthropic");
    await user.type(screen.getByPlaceholderText("4"), "8");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(fakes.calls.saves).toEqual([{ providerId: "anthropic", limit: 8 }]);
    // After save the component reloads the limits list (now showing the row).
    expect(fakes.calls.loadLimits).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText(/1 limit configured/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Remove concurrency limit for anthropic")).toBeVisible();
  });

  it("disables Add when the limit is empty/invalid (provider is auto-selected)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ limits: [], status: [] });
    render(ConcurrencyView, {
      props: {
        models: MODELS,
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    const providerSelect = await screen.findByLabelText("Provider");
    // A provider is auto-selected from the dropdown.
    expect((providerSelect as HTMLSelectElement).value).not.toBe("");
    const addBtn = screen.getByRole("button", { name: "Add" });
    expect(addBtn).toBeDisabled(); // no limit entered yet

    // An invalid (non-numeric) limit keeps Add disabled.
    await user.type(screen.getByPlaceholderText("4"), "abc");
    expect(addBtn).toBeDisabled();

    // A valid positive-integer limit enables Add.
    const limitInput = screen.getByPlaceholderText("4");
    await user.clear(limitInput);
    await user.type(limitInput, "5");
    expect(addBtn).toBeEnabled();
  });

  it("shows no-providers + disables the dropdown when there are no models", async () => {
    const fakes = makeFakes({ limits: [], status: [] });
    render(ConcurrencyView, {
      props: {
        models: [],
        loadLimits: fakes.loadLimits,
        saveLimit: fakes.saveLimit,
        deleteLimit: fakes.deleteLimit,
        loadStatus: fakes.loadStatus,
      },
    });

    const providerSelect = await screen.findByLabelText("Provider");
    expect(providerSelect).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("removes a provider limit via the row ✕ (calls deleteLimit + reloads)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes();
    render(ConcurrencyView, {
      props: {
        models: MODELS,
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
      models: MODELS,
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
