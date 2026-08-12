import { describe, expect, it } from "vitest";
import {
  isVisionModel,
  joinModelName,
  migrateLegacyModelName,
  modelKeyLabel,
  modelKeys,
  modelsForKey,
  openCodeNumber,
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

  it("sorts numbered OpenCode keys numerically (#2 before #10)", () => {
    expect(
      modelKeys(["opencode-10/models", "opencode-2/models", "opencode-1/models", "openai/gpt-4"]),
    ).toEqual(["opencode-1", "opencode-2", "opencode-10", "openai"]);
  });

  it("is empty for no models", () => {
    expect(modelKeys([])).toEqual([]);
  });
});

describe("openCodeNumber", () => {
  it("parses a numbered OpenCode key", () => {
    expect(openCodeNumber("opencode-1")).toBe(1);
    expect(openCodeNumber("opencode-10")).toBe(10);
  });

  it("returns null for non-openCode / malformed keys", () => {
    expect(openCodeNumber("umans")).toBeNull();
    expect(openCodeNumber("opencode")).toBeNull();
    expect(openCodeNumber("opencode-0")).toBeNull();
    expect(openCodeNumber("opencode-01")).toBeNull();
  });
});

describe("modelKeyLabel", () => {
  it("labels a numbered OpenCode key as OpenCode #N", () => {
    expect(modelKeyLabel("opencode-2")).toBe("OpenCode #2");
    expect(modelKeyLabel("opencode-10")).toBe("OpenCode #10");
  });

  it("leaves non-OpenCode keys unchanged", () => {
    expect(modelKeyLabel("umans")).toBe("umans");
  });
});

describe("migrateLegacyModelName", () => {
  it("rewrites opencode/<model> to opencode-1/<model>", () => {
    expect(migrateLegacyModelName("opencode/deepseek-v4-flash")).toBe(
      "opencode-1/deepseek-v4-flash",
    );
    expect(migrateLegacyModelName("opencode/nested/model")).toBe("opencode-1/nested/model");
  });

  it("leaves already-numbered and other-provider names unchanged", () => {
    expect(migrateLegacyModelName("opencode-1/deepseek-v4-flash")).toBe(
      "opencode-1/deepseek-v4-flash",
    );
    expect(migrateLegacyModelName("umans/umans-glm-5.2")).toBe("umans/umans-glm-5.2");
    expect(migrateLegacyModelName("opencode-2/x")).toBe("opencode-2/x");
  });

  it("is idempotent", () => {
    const once = migrateLegacyModelName("opencode/deepseek-v4-flash");
    expect(migrateLegacyModelName(once)).toBe(once);
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
