import type { ConcurrencyStatusEntry } from "@dispatch/transport-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type {
  ConcurrencyCooldownResult,
  ConcurrencyDeleteResult,
  ConcurrencyLimitResult,
  ConcurrencyLimitsResult,
  ConcurrencyStatusResult,
} from "../logic/types";
import ConcurrencyView from "./ConcurrencyView.svelte";

// Available models → provider ids are "umans", "anthropic", "openai-compat".
const MODELS = ["umans/umans-glm-5.2", "anthropic/claude-sonnet", "openai-compat/gpt-4o"] as const;

// A status entry factory (defaults to a healthy limited provider). The new
// concurrency-fixes fields (`cooldownMs`, `autoReduced`) are always present.
function statusEntry(over: Partial<ConcurrencyStatusEntry> = {}): ConcurrencyStatusEntry {
  return {
    providerId: "umans",
    limit: 4,
    inFlight: 2,
    queued: 1,
    paused: false,
    cooldownMs: 350,
    autoReduced: false,
    ...over,
  };
}

// Fakes for the injected ports. Each resolves immediately so the mount effect's
// initial load settles in a microtask (assertions await via findBy*). The status
// list is mutable so a test can flip `autoReduced` between polls to simulate a
// restore clearing the banner.
function makeFakes(opts?: {
  limits?: readonly { providerId: string; limit: number }[];
  status?: ConcurrencyStatusEntry[];
  /**
   * When set, `saveLimit` rejects with this error (returns `ok: false`) — used
   * to test the auto-reduce banner's inline restore-error feedback.
   */
  saveLimitError?: string;
  /**
   * Optional hook invoked inside `saveLimit` AFTER recording the call. Lets a
   * test simulate a backend side-effect of the PUT (e.g. clearing `autoReduced`
   * on the next status poll). Receives the providerId + limit + the fakes bag so
   * it can mutate the status list. (A plain method reassignment would NOT reach
   * the already-rendered component — the prop captured the original closure.)
   */
  onSaveLimit?: (
    providerId: string,
    limit: number,
    self: { calls: MakeFakesCalls; setStatus: (next: ConcurrencyStatusEntry[]) => void },
  ) => void;
}) {
  let limits = opts?.limits ?? [{ providerId: "umans", limit: 4 }];
  let status = opts?.status ?? [statusEntry()];
  const onSaveLimit = opts?.onSaveLimit;
  const saveLimitError = opts?.saveLimitError;

  const calls: MakeFakesCalls = {
    loadLimits: 0,
    loadStatus: 0,
    saves: [] as { providerId: string; limit: number }[],
    deletes: [] as string[],
    cooldownSaves: [] as { providerId: string; cooldownMs: number }[],
  };

  function setStatus(next: ConcurrencyStatusEntry[]): void {
    status = next;
  }

  return {
    calls,
    // Allow a test to mutate the status list between polls (e.g. clear
    // autoReduced after a restore to simulate the next poll).
    setStatus,
    loadLimits: async (): Promise<ConcurrencyLimitsResult> => {
      calls.loadLimits++;
      return { ok: true, limits };
    },
    saveLimit: async (providerId: string, limit: number): Promise<ConcurrencyLimitResult> => {
      calls.saves.push({ providerId, limit });
      if (saveLimitError !== undefined) {
        return { ok: false, error: saveLimitError };
      }
      // Reflect the new limit into the list the next load returns.
      limits = [...limits.filter((l) => l.providerId !== providerId), { providerId, limit }];
      if (onSaveLimit !== undefined) onSaveLimit(providerId, limit, { calls, setStatus });
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
    saveCooldown: async (
      providerId: string,
      cooldownMs: number,
    ): Promise<ConcurrencyCooldownResult> => {
      calls.cooldownSaves.push({ providerId, cooldownMs });
      // Reflect the new cooldown into the status list the next load returns.
      status = status.map((s) => (s.providerId === providerId ? { ...s, cooldownMs } : s));
      return { ok: true, providerId, cooldownMs };
    },
  };
}

type MakeFakesCalls = {
  loadLimits: number;
  loadStatus: number;
  saves: { providerId: string; limit: number }[];
  deletes: string[];
  cooldownSaves: { providerId: string; cooldownMs: number }[];
};

function props(fakes: ReturnType<typeof makeFakes>) {
  return {
    models: MODELS as unknown as readonly string[],
    loadLimits: fakes.loadLimits,
    saveLimit: fakes.saveLimit,
    deleteLimit: fakes.deleteLimit,
    loadStatus: fakes.loadStatus,
    saveCooldown: fakes.saveCooldown,
  };
}

describe("ConcurrencyView", () => {
  it("loads + renders the configured limits and live status on mount", async () => {
    const fakes = makeFakes();
    render(ConcurrencyView, { props: props(fakes) });

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

  it("renders the per-provider cooldown label from the live status", async () => {
    const fakes = makeFakes({ status: [statusEntry({ cooldownMs: 350 })] });
    render(ConcurrencyView, { props: props(fakes) });

    // The status card shows the cooldown alongside in-flight/queue.
    expect(await screen.findByText(/cooldown 350ms/)).toBeInTheDocument();
  });

  it("surfaces NO loading indicator during refresh (background poll is silent — no flicker)", async () => {
    // The 2s status poll + post-mutation reloads are SILENT: they never toggle a
    // visible loading state, so the Refresh buttons are plain-text (no spinner)
    // and the list area never reflows mid-refresh. Regression guard for the
    // flicker fix (mirrors the heartbeat runs list).
    const fakes = makeFakes();
    render(ConcurrencyView, { props: props(fakes) });

    await screen.findByText(/1 provider · 2\/4 in flight · 1 queued/);

    const statusRefresh = screen.getByLabelText("Refresh concurrency status");
    expect(statusRefresh).toHaveTextContent("Refresh");
    expect(statusRefresh.querySelector(".loading-spinner")).toBeNull();
    expect(statusRefresh).not.toBeDisabled();

    const limitsRefresh = screen.getByLabelText("Refresh concurrency limits");
    expect(limitsRefresh).toHaveTextContent("Refresh");
    expect(limitsRefresh.querySelector(".loading-spinner")).toBeNull();

    // A manual refresh stays silent too (no spinner appears).
    await fakes.loadStatus();
    expect(statusRefresh.querySelector(".loading-spinner")).toBeNull();
  });

  it("adds a provider limit via the dropdown form (calls saveLimit + reloads)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ limits: [], status: [] });
    render(ConcurrencyView, { props: props(fakes) });

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
    render(ConcurrencyView, { props: props(fakes) });

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
      props: { ...props(fakes), models: [] as unknown as readonly string[] },
    });

    const providerSelect = await screen.findByLabelText("Provider");
    expect(providerSelect).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("removes a provider limit via the row ✕ (calls deleteLimit + reloads)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes();
    render(ConcurrencyView, { props: props(fakes) });

    // Wait for the limits to load (unique summary) before interacting.
    await screen.findByText(/1 limit configured/);
    await user.click(screen.getByLabelText("Remove concurrency limit for umans"));

    expect(fakes.calls.deletes).toEqual(["umans"]);
    expect(fakes.calls.loadLimits).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a load error from the limits endpoint", async () => {
    const failing = {
      models: MODELS as unknown as readonly string[],
      loadLimits: async (): Promise<ConcurrencyLimitsResult> => ({
        ok: false,
        error: "Concurrency service not available",
      }),
      saveLimit: async (): Promise<ConcurrencyLimitResult> => ({ ok: false, error: "noop" }),
      deleteLimit: async (): Promise<ConcurrencyDeleteResult> => ({ ok: false, error: "noop" }),
      loadStatus: async (): Promise<ConcurrencyStatusResult> => ({ ok: true, providers: [] }),
      saveCooldown: async (): Promise<ConcurrencyCooldownResult> => ({ ok: false, error: "noop" }),
    };
    render(ConcurrencyView, { props: failing });
    expect(await screen.findByText("Concurrency service not available")).toBeVisible();
  });

  // ── Concurrency-fixes: auto-reduce banner + cooldown editing ────────────────

  it("renders an auto-reduce banner (with the backend notice + Restore) when a provider is auto-reduced", async () => {
    const fakes = makeFakes({
      status: [
        statusEntry({
          limit: 3,
          autoReduced: true,
          autoReducedFrom: 4,
          notice: "Concurrency limit auto-reduced to 3 after a 429 — restore manually when ready.",
        }),
      ],
    });
    render(ConcurrencyView, { props: props(fakes) });

    // The banner shows the backend notice verbatim + a "Restore to 4" action.
    expect(await screen.findByText(/auto-reduced to 3 after a 429/)).toBeVisible();
    expect(await screen.findByRole("button", { name: /Restore to 4/ })).toBeVisible();
    // The "Was 4, now 3." provenance line is shown.
    expect(await screen.findByText(/Was 4, now 3\./)).toBeVisible();
  });

  it("clears the banner after Restore (next status poll shows autoReduced===false)", async () => {
    const user = userEvent.setup();
    // Start auto-reduced (limit 3, was 4). The restore PUT clears `autoReduced`
    // server-side; the next status poll returns limit 4 + autoReduced===false →
    // the banner drops.
    const fakes = makeFakes({
      status: [
        statusEntry({
          limit: 3,
          autoReduced: true,
          autoReducedFrom: 4,
          notice: "Concurrency limit auto-reduced to 3 after a 429.",
        }),
      ],
      onSaveLimit: (_providerId, limit, self) => {
        // Simulate the backend clearing `autoReduced` on the manual PUT: the next
        // status load returns the restored limit with autoReduced===false.
        self.setStatus([statusEntry({ limit, autoReduced: false })]);
      },
    });
    render(ConcurrencyView, { props: props(fakes) });

    const restoreBtn = await screen.findByRole("button", { name: /Restore to 4/ });
    await user.click(restoreBtn);

    // The restore PUT the limit back to the original (autoReducedFrom = 4).
    expect(fakes.calls.saves).toEqual([{ providerId: "umans", limit: 4 }]);
    // The banner is gone (no Restore button, no notice text); the status summary
    // now reflects the restored limit (2/4 in flight).
    await screen.findByText(/1 provider · 2\/4 in flight · 1 queued/);
    expect(screen.queryByRole("button", { name: /Restore to/ })).toBeNull();
    expect(screen.queryByText(/auto-reduced to 3 after a 429/)).toBeNull();
  });

  it("dismisses the auto-reduce banner locally while it stays auto-reduced", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({
      status: [
        statusEntry({
          limit: 3,
          autoReduced: true,
          autoReducedFrom: 4,
          notice: "Concurrency limit auto-reduced to 3 after a 429.",
        }),
      ],
    });
    render(ConcurrencyView, { props: props(fakes) });

    await screen.findByRole("button", { name: /Restore to 4/ });
    // Dismiss the banner (hide locally — the provider is still auto-reduced).
    await user.click(screen.getByLabelText("Dismiss auto-reduce notice for umans"));
    expect(screen.queryByRole("button", { name: /Restore to/ })).toBeNull();
    expect(screen.queryByText(/auto-reduced to 3 after a 429/)).toBeNull();
  });

  it("shows an inline error in the banner when the Restore PUT fails (no silent re-enable)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({
      status: [
        statusEntry({
          limit: 3,
          autoReduced: true,
          autoReducedFrom: 4,
          notice: "Concurrency limit auto-reduced to 3 after a 429.",
        }),
      ],
      saveLimitError: "Concurrency service not available",
    });
    render(ConcurrencyView, { props: props(fakes) });

    const restoreBtn = await screen.findByRole("button", { name: /Restore to 4/ });
    await user.click(restoreBtn);

    // The error surfaces INLINE in the banner (near the restore action), not
    // only in the far-away limits section. The banner is still present (restore
    // did not succeed) and the button re-enabled for a retry.
    expect(await screen.findByTestId("restore-error-umans")).toHaveTextContent(
      "Concurrency service not available",
    );
    expect(screen.getByRole("button", { name: /Restore to 4/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Restore to 4/ })).not.toBeDisabled();
    // The restore PUT was attempted.
    expect(fakes.calls.saves).toEqual([{ providerId: "umans", limit: 4 }]);
  });

  it("clears the inline restore error on a retry that succeeds", async () => {
    const user = userEvent.setup();
    // First restore fails; the second succeeds (clears autoReduced). Reassigning
    // `fakes.saveLimit` BEFORE `props(fakes)` is captured would NOT reach the
    // rendered component, so swap it BEFORE render here.
    const fakes = makeFakes({
      status: [
        statusEntry({
          limit: 3,
          autoReduced: true,
          autoReducedFrom: 4,
          notice: "Concurrency limit auto-reduced to 3 after a 429.",
        }),
      ],
      onSaveLimit: (_providerId, limit, self) => {
        self.setStatus([statusEntry({ limit, autoReduced: false })]);
      },
    });
    let attempts = 0;
    const succeeding = fakes.saveLimit;
    fakes.saveLimit = async (providerId, limit) => {
      attempts++;
      if (attempts === 1) return { ok: false, error: "Concurrency service not available" };
      return succeeding(providerId, limit);
    };
    render(ConcurrencyView, { props: props(fakes) });

    const restoreBtn = await screen.findByRole("button", { name: /Restore to 4/ });
    await user.click(restoreBtn);
    // First attempt: inline error appears.
    expect(await screen.findByTestId("restore-error-umans")).toBeInTheDocument();

    // Retry: the error clears, the banner drops (restore succeeded).
    await user.click(screen.getByRole("button", { name: /Restore to 4/ }));
    await screen.findByText(/1 provider · 2\/4 in flight · 1 queued/);
    expect(screen.queryByTestId("restore-error-umans")).toBeNull();
    expect(screen.queryByRole("button", { name: /Restore to/ })).toBeNull();
  });

  it("edits the per-provider cooldown (PUT /concurrency/cooldown + reloads status)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ status: [statusEntry({ cooldownMs: 350 })] });
    render(ConcurrencyView, { props: props(fakes) });

    // Wait for the status card + its cooldown input (seeded with 350).
    const cooldownInput = await screen.findByLabelText("Release cooldown (ms) for umans");
    expect((cooldownInput as HTMLInputElement).value).toBe("350");

    await user.clear(cooldownInput);
    await user.type(cooldownInput, "500");
    await user.click(screen.getByRole("button", { name: "Save cooldown for umans" }));

    // The cooldown PUT fired with the new value.
    expect(fakes.calls.cooldownSaves).toEqual([{ providerId: "umans", cooldownMs: 500 }]);
    // After save the component reloads status (which now carries cooldownMs=500).
    expect(await screen.findByText(/cooldown 500ms/)).toBeInTheDocument();
  });

  it("rejects a negative cooldown input (Save disabled — non-negative integer only)", async () => {
    const user = userEvent.setup();
    const fakes = makeFakes({ status: [statusEntry({ cooldownMs: 350 })] });
    render(ConcurrencyView, { props: props(fakes) });

    const cooldownInput = await screen.findByLabelText("Release cooldown (ms) for umans");
    // 0 is valid (no cooldown); a negative is not.
    await user.clear(cooldownInput);
    await user.type(cooldownInput, "0");
    expect(screen.getByRole("button", { name: "Save cooldown for umans" })).toBeEnabled();

    await user.clear(cooldownInput);
    await user.type(cooldownInput, "-5");
    expect(screen.getByRole("button", { name: "Save cooldown for umans" })).toBeDisabled();
    expect(fakes.calls.cooldownSaves).toHaveLength(0);
  });
});
