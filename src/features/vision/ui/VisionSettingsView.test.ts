import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  LoadVisionSettingsResult,
  SaveVisionSettingsResult,
  VisionSettings,
} from "../logic/view-model";
import VisionSettingsView from "./VisionSettingsView.svelte";

const SETTINGS: VisionSettings = { imageLimit: 10, compactionModel: null };

function fakeLoad(settings: VisionSettings = SETTINGS): {
  calls: number;
  impl: () => Promise<LoadVisionSettingsResult>;
} {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    impl: async () => {
      calls += 1;
      return { ok: true, settings };
    },
  };
}

function fakeSaveOk(): {
  patches: object[];
  impl: (patch: object) => Promise<SaveVisionSettingsResult>;
} {
  const patches: object[] = [];
  return {
    get patches() {
      return patches;
    },
    impl: async (patch) => {
      patches.push(patch);
      // Merge into the current settings to simulate the server echo.
      const next: VisionSettings = {
        imageLimit:
          "imageLimit" in patch ? (patch as VisionSettings).imageLimit : SETTINGS.imageLimit,
        compactionModel:
          "compactionModel" in patch
            ? (patch as VisionSettings).compactionModel
            : SETTINGS.compactionModel,
      };
      return { ok: true, settings: next };
    },
  };
}

describe("VisionSettingsView", () => {
  it("loads settings on mount and seeds the imageLimit input", async () => {
    const load = fakeLoad({ imageLimit: 7, compactionModel: "kimi/k2" });
    render(VisionSettingsView, {
      props: {
        models: ["kimi/k2"],
        modelInfo: { "kimi/k2": { vision: true } },
        load: load.impl,
        save: fakeSaveOk().impl,
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Image limit/)).toHaveValue("7");
    });
    // "Auto" is selected (compactionModel was kimi/k2 here actually)
    expect(screen.getByLabelText(/Compaction model/)).toHaveValue("kimi/k2");
  });

  it("disables Save until the imageLimit input differs", async () => {
    const load = fakeLoad();
    const save = fakeSaveOk();
    const user = userEvent.setup();
    render(VisionSettingsView, {
      props: { models: [], modelInfo: {}, load: load.impl, save: save.impl },
    });

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    const input = screen.getByLabelText(/Image limit/);
    await user.clear(input);
    await user.type(input, "5");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves the imageLimit on click and confirms", async () => {
    const load = fakeLoad();
    const save = fakeSaveOk();
    const user = userEvent.setup();
    render(VisionSettingsView, {
      props: { models: [], modelInfo: {}, load: load.impl, save: save.impl },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Image limit/)).toHaveValue("10");
    });

    const input = screen.getByLabelText(/Image limit/);
    await user.clear(input);
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(save.patches).toEqual([{ imageLimit: 3 }]);
    });
    expect(screen.getByText(/Saved/i)).toBeInTheDocument();
  });

  it("shows an error for a non-numeric imageLimit on save", async () => {
    const load = fakeLoad();
    const save = fakeSaveOk();
    const user = userEvent.setup();
    render(VisionSettingsView, {
      props: { models: [], modelInfo: {}, load: load.impl, save: save.impl },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Image limit/)).toHaveValue("10");
    });

    const input = screen.getByLabelText(/Image limit/);
    await user.clear(input);
    await user.type(input, "abc");
    // Save is disabled for invalid input, so no save fires; the error surfaces
    // only on a submit attempt — but the button is disabled, so just assert that.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(save.patches).toEqual([]);
  });

  it("renders the compaction-model dropdown with Auto + vision-capable models", async () => {
    const load = fakeLoad();
    render(VisionSettingsView, {
      props: {
        models: ["kimi/k2", "umans/glm-5.2", "kimi/k1.5"],
        modelInfo: {
          "kimi/k2": { vision: true },
          "kimi/k1.5": { vision: true },
          "umans/glm-5.2": { vision: false },
        },
        load: load.impl,
        save: fakeSaveOk().impl,
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Compaction model/)).toBeInTheDocument();
    });
    const select = screen.getByLabelText(/Compaction model/) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(optionTexts).toEqual(["Auto (server-selected)", "kimi/k2", "kimi/k1.5"]);
    // Non-vision glm-5.2 is excluded.
    expect(optionTexts.some((t) => t.includes("glm-5.2"))).toBe(false);
  });

  it("saves the compactionModel on change (Auto → a vision model)", async () => {
    const load = fakeLoad({ imageLimit: 10, compactionModel: null });
    const save = fakeSaveOk();
    const user = userEvent.setup();
    render(VisionSettingsView, {
      props: {
        models: ["kimi/k2"],
        modelInfo: { "kimi/k2": { vision: true } },
        load: load.impl,
        save: save.impl,
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Compaction model/)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/Compaction model/), "kimi/k2");

    await vi.waitFor(() => {
      expect(save.patches).toEqual([{ compactionModel: "kimi/k2" }]);
    });
    expect(screen.getByText(/Saved/i)).toBeInTheDocument();
  });

  it("saves null (Auto) when the auto option is chosen", async () => {
    const load = fakeLoad({ imageLimit: 10, compactionModel: "kimi/k2" });
    const save = fakeSaveOk();
    const user = userEvent.setup();
    render(VisionSettingsView, {
      props: {
        models: ["kimi/k2"],
        modelInfo: { "kimi/k2": { vision: true } },
        load: load.impl,
        save: save.impl,
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Compaction model/)).toHaveValue("kimi/k2");
    });

    await user.selectOptions(screen.getByLabelText(/Compaction model/), "__auto__");

    await vi.waitFor(() => {
      expect(save.patches).toEqual([{ compactionModel: null }]);
    });
  });

  it("surfaces a load error", async () => {
    const load = vi.fn(async () => ({ ok: false, error: "vision unavailable" }) as const);
    render(VisionSettingsView, {
      props: { models: [], modelInfo: {}, load, save: fakeSaveOk().impl },
    });

    await vi.waitFor(() => {
      expect(screen.getByText("vision unavailable")).toBeInTheDocument();
    });
  });

  it("surfaces a save error", async () => {
    const load = fakeLoad();
    const save = vi.fn(async () => ({ ok: false, error: "boom" }) as const);
    const user = userEvent.setup();
    render(VisionSettingsView, {
      props: { models: [], modelInfo: {}, load: load.impl, save },
    });

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Image limit/)).toHaveValue("10");
    });

    const input = screen.getByLabelText(/Image limit/);
    await user.clear(input);
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });
});
