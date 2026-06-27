import type { ModelMetadata } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import {
  AUTO_COMPACTION_MODEL,
  compactionModelChanged,
  compactionModelFromValue,
  compactionModelOptions,
  DEFAULT_IMAGE_LIMIT,
  imageLimitChanged,
  imageLimitLabel,
  MAX_IMAGE_LIMIT,
  normalizeVisionSettings,
  parseImageLimit,
  selectedCompactionValue,
} from "./view-model";

describe("normalizeVisionSettings", () => {
  it("returns the value as-is for a well-formed body", () => {
    expect(normalizeVisionSettings({ imageLimit: 5, compactionModel: "kimi/k2" })).toEqual({
      imageLimit: 5,
      compactionModel: "kimi/k2",
    });
  });

  it("coerces a null compactionModel to null", () => {
    expect(normalizeVisionSettings({ imageLimit: 10, compactionModel: null })).toEqual({
      imageLimit: 10,
      compactionModel: null,
    });
  });

  it("defaults imageLimit when absent or non-numeric", () => {
    expect(normalizeVisionSettings({ compactionModel: "kimi/k2" })).toEqual({
      imageLimit: DEFAULT_IMAGE_LIMIT,
      compactionModel: "kimi/k2",
    });
    expect(normalizeVisionSettings({ imageLimit: "oops", compactionModel: null })).toEqual({
      imageLimit: DEFAULT_IMAGE_LIMIT,
      compactionModel: null,
    });
  });

  it("floors a fractional imageLimit", () => {
    expect(normalizeVisionSettings({ imageLimit: 7.9, compactionModel: null }).imageLimit).toBe(7);
  });

  it("defaults for a null/non-object body (never crashes)", () => {
    expect(normalizeVisionSettings(null)).toEqual({
      imageLimit: DEFAULT_IMAGE_LIMIT,
      compactionModel: null,
    });
    expect(normalizeVisionSettings("nope")).toEqual({
      imageLimit: DEFAULT_IMAGE_LIMIT,
      compactionModel: null,
    });
  });

  it("treats a negative imageLimit as the default", () => {
    expect(normalizeVisionSettings({ imageLimit: -3, compactionModel: null }).imageLimit).toBe(
      DEFAULT_IMAGE_LIMIT,
    );
  });

  it("treats an empty compactionModel string as null", () => {
    expect(
      normalizeVisionSettings({ imageLimit: 10, compactionModel: "" }).compactionModel,
    ).toBeNull();
  });
});

describe("parseImageLimit", () => {
  it("parses a non-negative integer", () => {
    expect(parseImageLimit("5")).toEqual({ ok: true, value: 5 });
    expect(parseImageLimit("0")).toEqual({ ok: true, value: 0 });
  });

  it("floors a fractional value", () => {
    expect(parseImageLimit("7.9")).toEqual({ ok: true, value: 7 });
  });

  it("trims whitespace", () => {
    expect(parseImageLimit("  12  ")).toEqual({ ok: true, value: 12 });
  });

  it("errors on empty input", () => {
    expect(parseImageLimit("")).toEqual({ ok: false, error: "Enter a number." });
  });

  it("errors on non-numeric input", () => {
    expect(parseImageLimit("lots").ok).toBe(false);
  });

  it("errors on a negative value", () => {
    expect(parseImageLimit("-1").ok).toBe(false);
  });

  it("errors when above the max", () => {
    expect(parseImageLimit(String(MAX_IMAGE_LIMIT + 1)).ok).toBe(false);
  });

  it("accepts the max", () => {
    expect(parseImageLimit(String(MAX_IMAGE_LIMIT))).toEqual({ ok: true, value: MAX_IMAGE_LIMIT });
  });
});

describe("imageLimitChanged", () => {
  it("is true when the typed value differs after normalization", () => {
    expect(imageLimitChanged("5", 10)).toBe(true);
  });

  it("is false when equal", () => {
    expect(imageLimitChanged("10", 10)).toBe(false);
  });

  it("is false for invalid input", () => {
    expect(imageLimitChanged("abc", 10)).toBe(false);
    expect(imageLimitChanged("", 10)).toBe(false);
  });

  it("compares after flooring", () => {
    expect(imageLimitChanged("7.9", 7)).toBe(false);
  });
});

describe("compactionModelOptions", () => {
  const modelInfo: Record<string, ModelMetadata> = {
    "kimi/k2": { vision: true },
    "kimi/k1.5": { vision: true },
    "umans/glm-5.2": { vision: false },
    "openai/gpt-4": { contextWindow: 128000 },
  };

  it("includes the Auto option first", () => {
    const opts = compactionModelOptions([], {});
    expect(opts).toHaveLength(1);
    expect(opts[0]?.auto).toBe(true);
    expect(opts[0]?.value).toBe(AUTO_COMPACTION_MODEL);
  });

  it("includes only vision-capable models, in catalog order", () => {
    const models = ["umans/glm-5.2", "kimi/k2", "openai/gpt-4", "kimi/k1.5"];
    const opts = compactionModelOptions(models, modelInfo);
    expect(opts.map((o) => o.label)).toEqual(["Auto (server-selected)", "kimi/k2", "kimi/k1.5"]);
  });

  it("excludes non-vision models even with metadata present", () => {
    const opts = compactionModelOptions(["umans/glm-5.2"], modelInfo);
    expect(opts).toHaveLength(1); // only Auto
  });
});

describe("compactionModel value round-trip", () => {
  it("selectedCompactionValue maps null to the auto sentinel", () => {
    expect(selectedCompactionValue(null)).toBe(AUTO_COMPACTION_MODEL);
  });

  it("selectedCompactionValue maps a model name to itself", () => {
    expect(selectedCompactionValue("kimi/k2")).toBe("kimi/k2");
  });

  it("compactionModelFromValue maps the auto sentinel back to null", () => {
    expect(compactionModelFromValue(AUTO_COMPACTION_MODEL)).toBeNull();
  });

  it("compactionModelFromValue maps a model name to itself", () => {
    expect(compactionModelFromValue("kimi/k2")).toBe("kimi/k2");
  });
});

describe("compactionModelChanged", () => {
  it("is true when the value maps to a different model", () => {
    expect(compactionModelChanged("kimi/k2", null)).toBe(true);
    expect(compactionModelChanged(AUTO_COMPACTION_MODEL, "kimi/k2")).toBe(true);
  });

  it("is false when equal (null vs auto, or same model)", () => {
    expect(compactionModelChanged(AUTO_COMPACTION_MODEL, null)).toBe(false);
    expect(compactionModelChanged("kimi/k2", "kimi/k2")).toBe(false);
  });
});

describe("imageLimitLabel", () => {
  it("labels null as loading", () => {
    expect(imageLimitLabel(null)).toBe("Loading…");
  });

  it("labels 0 as disabled", () => {
    expect(imageLimitLabel(0)).toBe("0 (compaction disabled)");
  });

  it("labels the default with (default)", () => {
    expect(imageLimitLabel(DEFAULT_IMAGE_LIMIT)).toBe(`${DEFAULT_IMAGE_LIMIT} (default)`);
  });

  it("labels other values plainly", () => {
    expect(imageLimitLabel(7)).toBe("7");
  });
});
