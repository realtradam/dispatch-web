import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASONING_EFFORT,
  effectiveEffort,
  effectiveSelection,
  effortOptions,
  isReasoningEffort,
  isThinkingSelection,
  REASONING_EFFORT_LEVELS,
  selectionOptions,
} from "./reasoning-effort";

describe("reasoning-effort helpers", () => {
  it("ladder matches the wire contract, in ascending depth order", () => {
    expect(REASONING_EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("the server default is high", () => {
    expect(DEFAULT_REASONING_EFFORT).toBe("high");
  });

  it("isReasoningEffort narrows ladder strings and rejects everything else", () => {
    for (const level of REASONING_EFFORT_LEVELS) {
      expect(isReasoningEffort(level)).toBe(true);
    }
    expect(isReasoningEffort("banana")).toBe(false);
    expect(isReasoningEffort("")).toBe(false);
    expect(isReasoningEffort("HIGH")).toBe(false);
  });

  it("effectiveEffort maps null (never set) to the default, not 'off'", () => {
    expect(effectiveEffort(null)).toBe("high");
  });

  it("effectiveEffort passes a persisted value through", () => {
    expect(effectiveEffort("xhigh")).toBe("xhigh");
    expect(effectiveEffort("low")).toBe("low");
  });

  it("effortOptions lists every level once and marks only the default", () => {
    const options = effortOptions();
    expect(options.map((o) => o.value)).toEqual([...REASONING_EFFORT_LEVELS]);
    expect(options.find((o) => o.value === "high")?.label).toBe("high (default)");
    for (const option of options) {
      if (option.value !== "high") expect(option.label).toBe(option.value);
    }
  });
});

describe("thinking selection (the separate on/off axis)", () => {
  it("selectionOptions lists 'off' first, then the ladder (default marked)", () => {
    const options = selectionOptions();
    expect(options).toHaveLength(1 + REASONING_EFFORT_LEVELS.length);
    expect(options[0]?.value).toBe("off");
    expect(options[0]?.label).toBe("Off");
    // the rest are the ladder, unchanged from effortOptions()
    expect(options.slice(1).map((o) => o.value)).toEqual([...REASONING_EFFORT_LEVELS]);
    expect(options.find((o) => o.value === "high")?.label).toBe("high (default)");
  });

  it("isThinkingSelection narrows 'off' + ladder strings, rejects the rest", () => {
    expect(isThinkingSelection("off")).toBe(true);
    for (const level of REASONING_EFFORT_LEVELS) {
      expect(isThinkingSelection(level)).toBe(true);
    }
    expect(isThinkingSelection("banana")).toBe(false);
    expect(isThinkingSelection("")).toBe(false);
    expect(isThinkingSelection("OFF")).toBe(false);
    expect(isThinkingSelection("none")).toBe(false); // NOT a wire value we send
  });

  it("effectiveSelection shows 'off' when thinking is explicitly disabled", () => {
    // thinking off is a SEPARATE axis: the effort level is irrelevant while off.
    expect(effectiveSelection("xhigh", false)).toBe("off");
    expect(effectiveSelection(null, false)).toBe("off");
  });

  it("effectiveSelection shows the effort level when thinking is on (default)", () => {
    // null thinking = never set ⇒ thinking ON (default) ⇒ show the effort level.
    expect(effectiveSelection(null, null)).toBe("high"); // default effort
    expect(effectiveSelection("low", null)).toBe("low");
    expect(effectiveSelection("max", true)).toBe("max"); // explicitly on
  });
});
