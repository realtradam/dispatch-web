import { describe, expect, it } from "vitest";
import {
  fullModelFromSelection,
  modelFromFull,
  modelsForProvider,
  providerFromModel,
  providerLabel,
  providerOptions,
} from "./options";

const MODELS = [
  "opencode-2/gpt-5",
  "opencode-1/claude-sonnet-4.5",
  "umans/umans-glm-5.2",
  "opencode-10/defiant",
  "umans/umans-gpt-5",
  "hyper/fast-1",
] as const;

describe("providerFromModel / modelFromFull", () => {
  it("splits a <provider>/<model> on the first slash", () => {
    expect(providerFromModel("opencode-1/claude-sonnet-4.5")).toBe("opencode-1");
    expect(modelFromFull("opencode-1/claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
  });

  it("treats a slashless name as all-provider", () => {
    expect(providerFromModel("umans")).toBe("umans");
    expect(modelFromFull("umans")).toBe("");
  });
});

describe("providerOptions", () => {
  it("sorts numbered OpenCode credentials numerically before other providers", () => {
    expect(providerOptions([...MODELS])).toEqual([
      "opencode-1",
      "opencode-2",
      "opencode-10",
      "umans",
      "hyper",
    ]);
  });

  it("keeps first-seen order and dedupes", () => {
    expect(providerOptions(["b/x", "a/y", "b/z"])).toEqual(["b", "a"]);
  });
});

describe("modelsForProvider", () => {
  it("returns only the model suffixes under the provider, in order", () => {
    expect(modelsForProvider([...MODELS], "umans")).toEqual(["umans-glm-5.2", "umans-gpt-5"]);
    expect(modelsForProvider([...MODELS], "hyper")).toEqual(["fast-1"]);
  });

  it("returns [] for an unknown provider", () => {
    expect(modelsForProvider([...MODELS], "missing")).toEqual([]);
  });
});

describe("providerLabel", () => {
  it("labels numbered OpenCode providers, leaves others unchanged", () => {
    expect(providerLabel("opencode-2")).toBe("OpenCode #2");
    expect(providerLabel("umans")).toBe("umans");
  });
});

describe("fullModelFromSelection", () => {
  it("recombines a provider + model suffix", () => {
    expect(fullModelFromSelection("opencode-1", "claude-sonnet-4.5")).toBe(
      "opencode-1/claude-sonnet-4.5",
    );
  });
});
