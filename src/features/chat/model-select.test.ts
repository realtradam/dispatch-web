import { describe, expect, it } from "vitest";
import {
  isVisionModel,
  joinModelName,
  modelKeys,
  modelsForKey,
  splitModelName,
} from "./model-select";

describe("splitModelName", () => {
  it("splits on the first slash", () => {
    expect(splitModelName("openai/gpt-4")).toEqual({ key: "openai", model: "gpt-4" });
  });

  it("keeps slashes in the model part (splits only the first)", () => {
    expect(splitModelName("openrouter/anthropic/claude")).toEqual({
      key: "openrouter",
      model: "anthropic/claude",
    });
  });

  it("treats a slashless name as all key", () => {
    expect(splitModelName("local")).toEqual({ key: "local", model: "" });
  });
});

describe("joinModelName", () => {
  it("recombines key + model", () => {
    expect(joinModelName("openai", "gpt-4")).toBe("openai/gpt-4");
  });

  it("returns just the key when the model is empty", () => {
    expect(joinModelName("local", "")).toBe("local");
  });

  it("round-trips with splitModelName", () => {
    const full = "openrouter/anthropic/claude";
    const { key, model } = splitModelName(full);
    expect(joinModelName(key, model)).toBe(full);
  });
});

describe("modelKeys", () => {
  it("returns distinct keys in first-seen order", () => {
    expect(
      modelKeys(["openai/gpt-4", "openai/gpt-4o", "anthropic/claude-3", "google/gemini"]),
    ).toEqual(["openai", "anthropic", "google"]);
  });

  it("is empty for no models", () => {
    expect(modelKeys([])).toEqual([]);
  });
});

describe("modelsForKey", () => {
  it("returns the model suffixes under a key, in order", () => {
    const models = ["openai/gpt-4", "anthropic/claude-3", "openai/gpt-4o"];
    expect(modelsForKey(models, "openai")).toEqual(["gpt-4", "gpt-4o"]);
  });

  it("returns empty for an unknown key", () => {
    expect(modelsForKey(["openai/gpt-4"], "anthropic")).toEqual([]);
  });
});

describe("isVisionModel", () => {
  it("returns true when modelInfo[name].vision is true", () => {
    const info = { "kimi/k2": { vision: true } };
    expect(isVisionModel(info, "kimi/k2")).toBe(true);
  });

  it("returns false when vision is false", () => {
    const info = { "umans/glm-5.2": { vision: false } };
    expect(isVisionModel(info, "umans/glm-5.2")).toBe(false);
  });

  it("returns false when vision is absent (unknown)", () => {
    const info = { "umans/glm-5.2": { contextWindow: 128000 } };
    expect(isVisionModel(info, "umans/glm-5.2")).toBe(false);
  });

  it("returns false for a model with no metadata entry at all", () => {
    expect(isVisionModel({}, "unknown/model")).toBe(false);
  });

  it("returns false for an empty modelInfo map", () => {
    expect(isVisionModel({}, "kimi/k2")).toBe(false);
  });
});
