import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadSystemPrompt, LoadSystemPromptVariables } from "../../system-prompt";
import type {
  HeartbeatConfig,
  HeartbeatConfigPatch,
  HeartbeatConfigResult,
  HeartbeatNextRunResult,
  HeartbeatStopResult,
  LoadHeartbeatConfig,
  LoadHeartbeatNextRun,
  LoadHeartbeatRuns,
  SaveHeartbeatConfig,
  StopHeartbeatRun,
} from "../logic/types";
import HeartbeatView from "./HeartbeatView.svelte";

// ── Fakes for the injected ports ─────────────────────────────────────────────
// Only the OUTERMOST edges are faked (the save/load ports); no sibling module is
// mocked. Mirrors the PromptEditor test's fake-port pattern.

function makeConfig(over: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    enabled: false,
    inactiveOnly: true,
    systemPrompt: "",
    taskPrompt: "",
    intervalMinutes: 30,
    model: "",
    reasoningEffort: null,
    ...over,
  };
}

/** A capturing saveConfig that echoes a merged config (so the form re-seeds). */
function fakeSaveConfig(initial: HeartbeatConfig): {
  calls: HeartbeatConfigPatch[];
  impl: SaveHeartbeatConfig;
} {
  const calls: HeartbeatConfigPatch[] = [];
  let current = initial;
  const impl: SaveHeartbeatConfig = async (patch) => {
    calls.push(patch);
    // Echo the merged config so the component re-seeds from the server response.
    current = { ...current, ...patch };
    return { ok: true, config: current } satisfies HeartbeatConfigResult;
  };
  return { calls, impl };
}

function fakeLoadConfig(config: HeartbeatConfig): LoadHeartbeatConfig {
  return vi.fn(async () => ({ ok: true, config }) as const);
}

function fakeLoadRuns(): LoadHeartbeatRuns {
  return vi.fn(async () => ({ ok: true, runs: [] }) as const);
}

function fakeStopRun(): StopHeartbeatRun {
  return vi.fn(async () => ({ ok: true }) as const satisfies HeartbeatStopResult);
}

function fakeLoadNextRun(): LoadHeartbeatNextRun {
  // No scheduled run (heartbeat disabled in the default config) → no countdown.
  return vi.fn(
    async () => ({ ok: true, nextRunAt: null }) as const satisfies HeartbeatNextRunResult,
  );
}

function fakeLoadVariables(): LoadSystemPromptVariables {
  return vi.fn(async () => ({ ok: true, variables: [] }) as const);
}

function fakeLoadDefaultPrompt(): LoadSystemPrompt {
  return vi.fn(async () => ({ ok: true, template: "" }) as const);
}

const baseProps = (overrides: Record<string, unknown> = {}) => ({
  models: [] as readonly string[],
  loadConfig: fakeLoadConfig(makeConfig()),
  saveConfig: fakeSaveConfig(makeConfig()).impl,
  loadVariables: fakeLoadVariables(),
  loadDefaultPrompt: fakeLoadDefaultPrompt(),
  loadRuns: fakeLoadRuns(),
  stopRun: fakeStopRun(),
  loadNextRun: fakeLoadNextRun(),
  onOpenRun: vi.fn(),
  ...overrides,
});

// HeartbeatView sets up polling intervals (runs + next-run + clock) on mount.
// Clear any stray timers between tests so a later test never hangs on a leaked
// interval (the $effect cleanup clears them on unmount; this is belt+suspenders).
afterEach(() => {
  vi.clearAllTimers();
});

describe("HeartbeatView — inactive-only checkbox", () => {
  it("renders checked when the loaded config has inactiveOnly: true (the default)", async () => {
    const loadConfig = fakeLoadConfig(makeConfig({ inactiveOnly: true }));
    render(HeartbeatView, {
      props: baseProps({ loadConfig }),
    });

    const checkbox = await screen.findByLabelText(
      "Only run the heartbeat when the workspace is idle",
    );
    expect(checkbox).toBeChecked();
  });

  it("renders unchecked when the loaded config has inactiveOnly: false", async () => {
    const loadConfig = fakeLoadConfig(makeConfig({ inactiveOnly: false }));
    render(HeartbeatView, {
      props: baseProps({ loadConfig }),
    });

    const checkbox = await screen.findByLabelText(
      "Only run the heartbeat when the workspace is idle",
    );
    expect(checkbox).not.toBeChecked();
  });

  it("toggling the checkbox persists a PARTIAL patch { inactiveOnly } and re-seeds", async () => {
    const user = userEvent.setup();
    const initial = makeConfig({ inactiveOnly: true });
    const save = fakeSaveConfig(initial);
    const loadConfig = fakeLoadConfig(initial);
    render(HeartbeatView, {
      props: baseProps({ loadConfig, saveConfig: save.impl }),
    });

    const checkbox = await screen.findByLabelText(
      "Only run the heartbeat when the workspace is idle",
    );
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    // The save port was called with ONLY { inactiveOnly: false } — a partial
    // update, not the whole config (mirrors the enable toggle's partial PUT).
    await vi.waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]).toEqual({ inactiveOnly: false });

    // After the save resolves, the checkbox reflects the server response (unchecked).
    await vi.waitFor(() => {
      expect(checkbox).not.toBeChecked();
    });
  });

  it("toggling back on sends { inactiveOnly: true }", async () => {
    const user = userEvent.setup();
    const initial = makeConfig({ inactiveOnly: false });
    const save = fakeSaveConfig(initial);
    const loadConfig = fakeLoadConfig(initial);
    render(HeartbeatView, {
      props: baseProps({ loadConfig, saveConfig: save.impl }),
    });

    const checkbox = await screen.findByLabelText(
      "Only run the heartbeat when the workspace is idle",
    );
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    await vi.waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]).toEqual({ inactiveOnly: true });
    await vi.waitFor(() => {
      expect(checkbox).toBeChecked();
    });
  });

  it("a failed save reverts the checkbox to the last-known state", async () => {
    const user = userEvent.setup();
    const initial = makeConfig({ inactiveOnly: true });
    const failingSave: SaveHeartbeatConfig = async () => ({
      ok: false,
      error: "boom",
    });
    const loadConfig = fakeLoadConfig(initial);
    render(HeartbeatView, {
      props: baseProps({ loadConfig, saveConfig: failingSave }),
    });

    const checkbox = await screen.findByLabelText(
      "Only run the heartbeat when the workspace is idle",
    );
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    // The failed save surfaces the error AND reverts the checkbox (stays checked).
    await vi.waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
    expect(checkbox).toBeChecked();
  });
});
