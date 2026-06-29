import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  HeartbeatConfigPatch,
  HeartbeatConfigResult,
  SaveHeartbeatConfig,
} from "../logic/types";
import PromptEditor from "./PromptEditor.svelte";

// Fakes for the injected ports.

function fakeLoadVariables() {
  return vi.fn(async () => ({ ok: true, variables: [] }) as const);
}

function fakeLoadDefaultPrompt(template = "You are a helpful assistant.") {
  return vi.fn(async () => ({ ok: true, template }) as const);
}

/** A capturing saveConfig that resolves ok, echoing the merged config shape. */
function fakeSaveConfig(): {
  calls: HeartbeatConfigPatch[];
  impl: SaveHeartbeatConfig;
} {
  const calls: HeartbeatConfigPatch[] = [];
  const impl: SaveHeartbeatConfig = async (patch) => {
    calls.push(patch);
    // Echo a config that reflects the persisted patch (so onSaved sync is realistic).
    const config = {
      enabled: false,
      inactiveOnly: true,
      systemPrompt: patch.systemPrompt ?? "",
      taskPrompt: patch.taskPrompt ?? "",
      intervalMinutes: 30,
      model: "openai/gpt-4o",
      reasoningEffort: null,
    };
    return { ok: true, config } satisfies HeartbeatConfigResult;
  };
  return { calls, impl };
}

const baseProps = (overrides: Record<string, unknown> = {}) => ({
  systemPrompt: "",
  taskPrompt: "",
  loadVariables: fakeLoadVariables(),
  loadDefaultPrompt: fakeLoadDefaultPrompt(),
  saveConfig: fakeSaveConfig().impl,
  onSaved: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe("PromptEditor save flow", () => {
  it("persists an edited system prompt and clears the unsaved state (regression: save flickered + reverted)", async () => {
    const user = userEvent.setup();
    const save = fakeSaveConfig();
    const onSaved = vi.fn();
    render(PromptEditor, {
      props: baseProps({
        // Start inheriting (empty override); the default pre-fills.
        systemPrompt: "",
        saveConfig: save.impl,
        onSaved,
      }),
    });

    // Wait for the default to load + pre-fill the system textarea.
    const systemBox = await screen.findByLabelText("Heartbeat system prompt");
    expect(systemBox).toHaveValue("You are a helpful assistant.");

    // Save is disabled while it matches the default (no explicit edit).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // Edit the system prompt → an override.
    await user.clear(systemBox);
    await user.type(systemBox, "custom override");

    // Save is now enabled.
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    // The save port was called with the override persisted verbatim.
    expect(save.calls).toHaveLength(1);
    expect(save.calls[0]?.systemPrompt).toBe("custom override");
    expect(onSaved).toHaveBeenCalledWith("custom override", "");

    // THE REGRESSION: after save, hasChanges must clear (Save disabled again)
    // and the "Saved." confirmation shows — NOT "Unsaved changes".
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    expect(screen.queryByText(/Unsaved changes/i)).not.toBeInTheDocument();
  });

  it("persisting text that matches the default sends '' (inherit) and clears unsaved state", async () => {
    const user = userEvent.setup();
    const save = fakeSaveConfig();
    render(PromptEditor, {
      props: baseProps({
        // Start with an override.
        systemPrompt: "old override",
        saveConfig: save.impl,
      }),
    });

    const systemBox = await screen.findByLabelText("Heartbeat system prompt");
    expect(systemBox).toHaveValue("old override");

    // Reset to default → text matches the default → saving inherits ("").
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(systemBox).toHaveValue("You are a helpful assistant.");

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    expect(save.calls).toHaveLength(1);
    expect(save.calls[0]?.systemPrompt).toBe(""); // inherit
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });

  it("editing the task prompt saves + clears unsaved state", async () => {
    const user = userEvent.setup();
    const save = fakeSaveConfig();
    render(PromptEditor, {
      props: baseProps({ saveConfig: save.impl }),
    });

    const taskBox = await screen.findByLabelText("Heartbeat task prompt");
    await user.type(taskBox, "do the thing");

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    expect(save.calls[0]?.taskPrompt).toBe("do the thing");
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });

  it("a failed save surfaces the error and keeps the edit unsaved", async () => {
    const user = userEvent.setup();
    const failingSave: SaveHeartbeatConfig = async () => ({ ok: false, error: "boom" });
    render(PromptEditor, {
      props: baseProps({ saveConfig: failingSave }),
    });

    const systemBox = await screen.findByLabelText("Heartbeat system prompt");
    await user.clear(systemBox);
    await user.type(systemBox, "custom");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("boom")).toBeInTheDocument();
    // Still unsaved (Save stays enabled), no success badge.
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });
});
